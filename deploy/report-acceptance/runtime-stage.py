#!/usr/bin/env python3
"""Prepare gateway environment and probe the compiled functions offline.

Only new staging paths and a disposable network-isolated container are changed.
Never applies production SQL, restarts production, or starts the archive timer.
"""
import base64
import fcntl
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit
from urllib.request import urlopen
import uuid

VERIFY_SHA = '5fe87fe3246e7b4df8928144b1a738d1ac4577baceb02f03e8137abe24348d14'
PROBE_SHA = 'e840ff6167757fda57c882e8938f592173284a928784df2f68bf7c430cc2e921'
PUBLIC = 'https://homemaster.qd.je'
INTERNAL = 'http://127.0.0.1:9000'
s = v = None

ENV_HELPER = r'''const bosConfig = JSON.parse(Deno.readTextFileSync('/bos-main/bos-report-env.json'));
const bosFunctions = new Set(['order-lifecycle-api','drive-archive-api','report-api','report-file-upload','hands-report-api','push-api','gas-bridge-health']);
if(bosConfig.version!==1||bosConfig.internal!=='http://127.0.0.1:9000'||bosConfig.public!=='https://homemaster.qd.je'||typeof bosConfig.legacy!=='string'||typeof bosConfig.workerKey!=='string'||bosConfig.workerKey.length<32||typeof bosConfig.gas!=='string')throw new Error('REPORT_ENV_INVALID');
export function bosReportEnv(slug, entries){
 if(!bosFunctions.has(slug))return entries;
 const overrides={SUPABASE_URL:bosConfig.internal,BOS_PUBLIC_URL:bosConfig.public,BOS_LEGACY_STORAGE_ORIGINS:bosConfig.legacy};
 if(slug==='drive-archive-api')overrides.BOS_DRIVE_WORKER_KEY=bosConfig.workerKey;
 if(slug==='drive-archive-api'||slug==='gas-bridge-health')overrides.BOS_DRIVE_GAS_URL=bosConfig.gas;
 return [...entries.filter(([key])=>!Object.prototype.hasOwnProperty.call(overrides,key)),...Object.entries(overrides)];
}
'''


def load_helpers():
    path = Path('/tmp/bos-verify.py')
    if path.resolve() != path or hashlib.sha256(path.read_bytes()).hexdigest() != VERIFY_SHA:
        raise RuntimeError('VERIFY_HELPER_CHANGED')
    spec = importlib.util.spec_from_file_location('bos_runtime_verify', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.s = module.load_stage()
    return module.s, module


def patch_gateway(source):
    s.require('bosReportEnv' not in source and 'bos-report-env' not in source, 'GATEWAY_ALREADY_PATCHED')
    pattern = re.compile(r'''\benvVars\s*:\s*(\[\s*\.\.\.\s*env\s*,\s*\[\s*(['"])([A-Z][A-Z0-9_]*)\2\s*,\s*slug\s*\]\s*\])''')
    matches = list(pattern.finditer(source))
    s.require(len(matches) == 1, 'GATEWAY_ENV_EXPRESSION_CHANGED')
    match = matches[0]
    start, end = match.span(1)
    patched = source[:start] + 'bosReportEnv(slug,' + source[start:end] + ')' + source[end:]
    return "import { bosReportEnv } from './bos-report-env.ts';\n" + patched


def worker_keys(source):
    matches = re.findall(r'\bconst\s+keys\s*=\s*(\[[^\]]*\])\s*;', source)
    s.require(len(matches) == 1, 'GATEWAY_KEY_LIST_CHANGED')
    # The observed list consists only of upper-case string literals.
    token = r'''\s*['"]([A-Z][A-Z0-9_]*)['"]\s*'''
    parts = matches[0][1:-1].split(',')
    names = []
    for part in parts:
        match = re.fullmatch(token, part)
        s.require(match is not None, 'GATEWAY_DYNAMIC_KEY_LIST')
        names.append(match.group(1))
    s.require(len(names)==len(set(names)), 'GATEWAY_DUPLICATE_KEYS')
    s.require({'SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','VK_APP_SECRET','BOS_SYNC_KEY'} <= set(names),
              'GATEWAY_REQUIRED_KEYS_MISSING')
    return names


def jwt(role, secret):
    def enc(value):
        return base64.urlsafe_b64encode(json.dumps(value,separators=(',',':')).encode()).rstrip(b'=').decode()
    value = enc({'alg':'HS256','typ':'JWT'}) + '.' + enc({'role':role,'iss':'supabase','exp':int(time.time())+3600})
    return value + '.' + base64.urlsafe_b64encode(hmac.new(secret.encode(),value.encode(),hashlib.sha256).digest()).rstrip(b'=').decode()


def dummy_environment(keys):
    env = {name:'isolated-fixture-value' for name in keys}
    env.update({'JWT_SECRET':'isolated-jwt-secret-never-valid-in-production',
                'VK_APP_SECRET':'isolated-vk-secret-never-valid-in-production',
                'BOS_SYNC_KEY':'isolated-sync-secret-never-valid-in-production',
                'SUPABASE_URL':'http://127.0.0.1:1'})
    env['SUPABASE_ANON_KEY'] = jwt('anon',env['JWT_SECRET'])
    env['SUPABASE_SERVICE_ROLE_KEY'] = jwt('service_role',env['JWT_SECRET'])
    for name, suffix in (('BOS_REST_ORIGIN','rest'),('BOS_STORAGE_ORIGIN','storage'),('BOS_AUTH_ORIGIN','auth')):
        env[name] = 'http://bos-release-probe-' + suffix + ':19001'
    return env


def runtime_arguments(edge, work, name, env):
    entry = edge['Config'].get('Entrypoint') or []
    s.require(len(entry)<=1 and isinstance(edge['Config'].get('Cmd'), list), 'RUNTIME_COMMAND_UNSUPPORTED')
    args = ['docker','run','-d','--pull=never','--network=none','--name',name,
            '--label','bos.report-runtime-probe='+name,'--memory=768m','--memory-swap=768m',
            '--cpus=1','--pids-limit=256','--user=0:0']
    for suffix in ('rest','storage','auth'):
        args += ['--add-host','bos-release-probe-'+suffix+':127.0.0.1']
    for name, value in env.items():
        args += ['-e',name+'='+value]
    for folder, target in (('candidate/edge/sources','/bos-src'),('candidate/edge/bundles','/bos-bundles'),('probe-main','/bos-main')):
        args += ['--mount','type=bind,src='+str(work/folder)+',dst='+target+',readonly']
    if entry:
        args += ['--entrypoint',entry[0]]
    return args + [edge['Image'], *edge['Config']['Cmd']]


def probe_runtime(edge, work, config, keys, probe):
    env = dummy_environment(keys)
    test_config = {**config,'workerKey':'isolated-worker-key-never-valid-in-production',
                   'gas':'http://127.0.0.1:19001/gas'}
    shutil.copytree(work/'candidate/edge/main',work/'probe-main')
    (work/'probe-main/bos-report-env.json').write_text(json.dumps(test_config))
    name = 'bos301-runtime-'+uuid.uuid4().hex
    created = False
    try:
        v.run(runtime_arguments(edge,work,name,env),work,'runtime-start')
        created = True
        v.assert_isolated(name,work)
        pid = s.inspect(name)['State']['Pid']
        fixture = {'jwt_secret':env['JWT_SECRET'],'vk_secret':env['VK_APP_SECRET'],
                   'worker_key':test_config['workerKey']}
        result = v.run(['nsenter','-t',str(pid),'-n',sys.executable,str(probe)],work,'runtime-probe',
                       json.dumps(fixture).encode(),timeout=150)
        outcome = json.loads(result)
        s.require(outcome and all(value is True for value in outcome.values()), 'RUNTIME_PROBE_INCOMPLETE')
        return outcome
    except s.Stop:
        log = work/'logs/runtime-probe.log'
        if log.is_file():
            content = s.read(log)
            diagnostics = re.findall(rb'^RUNTIME_PROBE_DIAGNOSTIC=(.{1,16000})$',content,re.M)
            if diagnostics:
                info = json.loads(diagnostics[-1])
                for key,label in (('last','RUNTIME_HTTP'),('upstream','RUNTIME_UPSTREAM'),
                                  ('fixture_errors','RUNTIME_FIXTURE_ERRORS'),('effects','RUNTIME_EFFECTS')):
                    s.emit(label,info[key])
            matches = re.findall(rb'RUNTIME_PROBE_STOPPED=([A-Za-z0-9_-]+)',content)
            if matches:
                s.emit('RUNTIME_PROBE_FAILURE',matches[-1].decode())
        raise
    finally:
        if created:
            result = subprocess.run(['docker','logs',name],capture_output=True,timeout=15)
            s.write(work/'logs/runtime-container.log',result.stdout+b'\n'+result.stderr)
            v.run(['docker','rm','-fv',name],work,'runtime-remove')


def prepare_config(edge, stage, verification):
    env = v.environment(edge)
    for name in ('SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','VK_APP_SECRET','BOS_SYNC_KEY'):
        s.require(bool(env.get(name)), 'REQUIRED_RUNTIME_ENV_MISSING_'+name)
    origins = verification['database']['stored_report_origins']
    s.require(origins and all(x in ('https://139.100.237.167','https://136.234.17.113',PUBLIC,
                                   'https://obsropbslfwtanyspjbi.supabase.co') for x in origins), 'LEGACY_ORIGIN_REQUIRES_REVIEW')
    source = s.read(stage/'payload/after/supabase/functions/drive-archive-api/index.ts').decode()
    matches = re.findall(r"const GAS=Deno\.env\.get\('BOS_DRIVE_GAS_URL'\)\|\|'([^']+)'",source)
    s.require(len(matches)==1, 'GAS_FALLBACK_CHANGED')
    gas = env.get('BOS_DRIVE_GAS_URL') or matches[0]
    s.require(re.fullmatch(r'https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec',gas) is not None, 'GAS_ENDPOINT_UNSUPPORTED')
    return {'version':1,'internal':INTERNAL,'public':PUBLIC,'legacy':','.join(origins),
            'workerKey':secrets.token_urlsafe(48),'gas':gas}


def main():
    global s,v
    os.umask(0o077)
    sys.dont_write_bytecode = True
    s,v = load_helpers()
    s.require(os.geteuid()==0,'ROOT_REQUIRED')
    with (s.PARENT/'.report-acceptance-stage.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        checks = list(s.PARENT.glob('report-acceptance-stage-*/locked-*/verify-*/verification.json'))
        s.require(bool(checks),'DATABASE_VERIFICATION_MISSING')
        check_path = max(checks,key=lambda p:p.stat().st_mtime_ns)
        verification = json.loads(s.read(check_path))
        s.require(verification['status']=='database_verified_not_activated','DATABASE_NOT_VERIFIED')
        stage = Path(verification['candidate'])
        journal = stage/'journal.json'
        s.require(s.sha(s.read(journal))==verification['journal_sha256'],'VERIFIED_JOURNAL_CHANGED')
        rec = json.loads(s.read(journal))
        live = Path(rec['live'])
        for folder in ('edge','web'):
            s.require(s.tree(live/folder)==rec['before'][folder],'LIVE_RELEASE_CHANGED')
            s.require(s.tree(stage/'candidate'/folder)==rec['candidate_'+folder],'CANDIDATE_CHANGED')
        edge = s.inspect(rec['edge_id'])
        s.require(edge['Image']==rec['image'] and edge['State']['Running'],'EDGE_CHANGED')
        s.require('9000/tcp' in (edge['Config'].get('ExposedPorts') or {}) or
                  '9000/tcp' in edge['NetworkSettings']['Ports'],'GATEWAY_PORT_CHANGED')
        for folder,target in (('sources','/bos-src'),('bundles','/bos-bundles'),('main','/bos-main')):
            s.require(s.mount(edge,target)==live/'edge'/folder,'EDGE_MOUNT_CHANGED')
        gateway = s.read(stage/'candidate/edge/main/index.ts').decode()
        keys = worker_keys(gateway)
        patched = patch_gateway(gateway)
        config = prepare_config(edge,stage,verification)
        work = Path(tempfile.mkdtemp(prefix='runtime-',dir=stage))
        s.emit('RUNTIME_DIR',str(work))
        shutil.copytree(stage/'candidate/edge',work/'candidate/edge')
        (work/'candidate/edge/main/index.ts').write_text(patched)
        s.write(work/'candidate/edge/main/bos-report-env.ts',ENV_HELPER.encode())
        s.write(work/'candidate/edge/main/bos-report-env.json',json.dumps(config).encode())
        url = s.RAW+'deploy/report-acceptance-20261030/deploy/report-acceptance/runtime-probe.py'
        try:
            with urlopen(url,timeout=30) as response:
                data = response.read(100_001)
        except Exception:
            raise s.Stop('RUNTIME_PROBE_DOWNLOAD_FAILED') from None
        s.require(s.sha(data)==PROBE_SHA,'RUNTIME_PROBE_HASH_MISMATCH')
        probe = work/'runtime-probe.py'
        s.write(probe,data)
        s.emit('RUNTIME_ISOLATED_TEST_STARTED',True)
        outcome = probe_runtime(edge,work,config,keys,probe)
        for folder in ('edge','web'):
            s.require(s.tree(live/folder)==rec['before'][folder],'CONCURRENT_LIVE_CHANGE')
        s.require(s.inspect(edge['Id'])['Config']==edge['Config'],'CONCURRENT_EDGE_CONFIG_CHANGE')
        s.write(work/'runtime-journal.json',json.dumps({**rec,'status':'runtime_verified_not_activated',
                'prepared_stage':str(stage),'verification':str(check_path),'runtime_tests':outcome,
                'candidate_edge':s.tree(work/'candidate/edge'),'candidate_web_path':str(stage/'candidate/web'),
                'gateway_sha256':s.sha(gateway.encode()),'archive_timer_enabled':False,
                'gas_deployment_verified':False},indent=2).encode())
        s.emit('RUNTIME_TESTS',outcome)
        s.emit('RUNTIME_READY',True)
        s.emit('ARCHIVE_TIMER_ENABLED',False)
        s.emit('GAS_DEPLOYMENT_VERIFIED',False)
        s.emit('PRODUCTION_UPDATED',False)


if __name__=='__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('RUNTIME_STOPPED=INTERRUPTED',flush=True)
        raise SystemExit(130)
    except Exception as error:
        label = str(error) if s is not None and isinstance(error,s.Stop) else 'COMMAND_OR_LAYOUT_UNAVAILABLE'
        print('RUNTIME_STOPPED='+label,flush=True)
        raise SystemExit(1)
