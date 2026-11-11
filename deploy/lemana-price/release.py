#!/usr/bin/env python3
"""Stage, verify, install or roll back only the reviewed Lemana price modules.

stage: backups plus frozen builds and isolated fixture calls; no live writes.
apply: recheck all snapshots, atomically install, restart only edge, verify.
rollback: restore only touched files whose content is still recognized.
The already applied SQL function is intentionally outside this release.
"""
import argparse
import base64
import concurrent.futures
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import time
from urllib.request import Request, urlopen
import uuid

sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[2]
LIVE = Path('/opt/business-os/deploy/release-to2wblxf')
WORK = Path('/root/bos-lemana-price')
EDGE = 'bos-release-to2wblxf-edge'
PUBLIC = 'https://homemaster.qd.je'
HELPERS = {
    'common.py':'9881eb3f4838d5def9b210372fdadce434a78cea86f0f1f47e68c4ef132cc40a',
    'eszip.py':'e08b2fa98c3e462a1c0b1ec529015e047f42a2836658ffea61b6236bbd36ef5f',
    'frozen.py':'03d0f9f6a43274420bbb20fcd169fa6b7b73a2c8d8ea5163f0adf7765a0742de'}
for filename, digest in HELPERS.items():
    path = REPO / 'deploy/finance-export' / filename
    if path.resolve() != path or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise SystemExit('STOP=REVIEWED_HELPER_CHANGED')
sys.path.insert(0, str(REPO / 'deploy/finance-export'))
import eszip
import frozen
from common import Stop, require, read, sha, atomic, item, tree, run, inspect, fingerprint, emit
sys.path.insert(0, str(Path(__file__).parent))
import overlay


def relative(name):
    return 'supabase/functions/'+name+'/index.ts'


def source_path(name):
    return 'edge/sources/'+name+'/'+relative(name)


def module_paths():
    return {'edge/sources/'+name+'/'+module for name in overlay.APIS for module in overlay.dependencies(name)}


def allowed(path):
    return path in (module_paths() |
        {'edge/bundles/'+n+'.eszip' for n in overlay.APIS} |
        {'web/'+x for x in (*overlay.WEB, 'startup-shell.bundle.js', 'startup-eager.bundle.js', 'index.html', 'sw.js', 'build-version.js')})


def host():
    edge = inspect(EDGE)
    require(edge['State']['Running'] and edge['State']['Pid'] > 0, 'EDGE_NOT_RUNNING')
    for part, target in [('sources','/bos-src'), ('bundles','/bos-bundles'), ('main','/bos-main')]:
        mounts = [m for m in edge['Mounts'] if m['Type'] == 'bind' and m['Destination'] == target]
        require(len(mounts) == 1 and mounts[0]['Source'] == str(LIVE / 'edge' / part), 'LIVE_MOUNT_CHANGED')
        require(not any(m['Destination'].startswith(target+'/') for m in edge['Mounts']), 'NESTED_MOUNT')
    require(re.fullmatch('sha256:[a-f0-9]{64}', edge['Image']), 'IMAGE_NOT_PINNED')
    ids = run(['docker','ps','-q']).decode().split()
    containers = json.loads(run(['docker','inspect',*ids]))
    webs = [c for c in containers if any(m['Type']=='bind' and m['Destination']=='/srv' and
            m['Source']==str(LIVE/'web') for m in c['Mounts'])]
    require(len(webs) == 1, 'LIVE_WEB_MOUNT_NOT_UNIQUE')
    return edge


def snapshot():
    return {'main':tree(LIVE/'edge/main'), 'web':tree(LIVE/'web'),
            'sources':{n:tree(LIVE/'edge/sources'/n) for n in overlay.APIS},
            'bundles':{n:item(LIVE/'edge/bundles'/(n+'.eszip')) for n in overlay.APIS}}


def isolated(name, work):
    info = inspect(name)
    require(info['State']['Running'] and info['State']['Pid'] > 0, 'PROBE_NOT_RUNNING')
    require(set(info['NetworkSettings']['Networks']) <= {'none'}, 'PROBE_NETWORK_CONNECTED')
    pid = info['State']['Pid']
    output = run(['nsenter','-t',str(pid),'-n',sys.executable,'-c',
                  'import socket,json;print(json.dumps([n for _,n in socket.if_nameindex()]))'],
                 work, 'interfaces-'+name, timeout=15)
    require(json.loads(output) == ['lo'], 'PROBE_HAS_EXTERNAL_INTERFACE')
    return pid


def remove_container(name, work):
    # The nonce and private label must both match before removal.
    result = run(['docker','ps','-aq','--filter','name=^/'+name+'$'], timeout=15).decode().strip()
    if result:
        info = inspect(result)
        require((info['Config'].get('Labels') or {}).get('bos.report-submit.stage') == str(work), 'STAGE_CONTAINER_LABEL')
        run(['docker','rm','-fv',result], work, 'cleanup-'+name, timeout=30)


def compile_apis(work, edge):
    compiler = work/'compiler'
    compiler.mkdir()
    output = work/'output'
    output.mkdir()
    graphs = {}
    for name in overlay.APIS:
        shutil.copytree(work/'backup-source'/name, compiler/name)
        graph = graphs[name] = eszip.parse(read(work/'backup'/('edge/bundles/'+name+'.eszip')))
        require(graph['checksum_kind'] in (0,1), 'BUNDLE_CHECKSUM_UNSUPPORTED')
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            integrities = dict(pool.map(frozen.integrity, sorted(graph['npm'])))
        entry = compiler/name/relative(name)
        config = entry.parent/'deno.json'
        require(not config.with_suffix('.jsonc').exists(), 'JSONC_CONFIG_UNSUPPORTED')
        value = json.loads(read(config)) if config.exists() else {'workspace':[]}
        value['lock'] = {'path':'./bos-report.lock','frozen':True}
        atomic(config, json.dumps(value).encode())
        atomic(entry.parent/'bos-report.lock', json.dumps(frozen.lockfile(graph, integrities)).encode())
    name = 'bos-report-build-'+uuid.uuid4().hex
    command = ['docker','run','-d','--pull=never','--network=bridge','--name',name,
        '--label','bos.report-submit.stage='+str(work), '--memory=768m','--memory-swap=768m',
        '--cpus=1','--pids-limit=256','--user=0:0','--entrypoint=/bin/sh',
        '--mount','type=bind,src='+str(compiler)+',dst=/bos-src,readonly',
        '--mount','type=bind,src='+str(output)+',dst=/bos-output',edge['Image'],
        '-c','while :; do sleep 1; done']
    def bundle(slug, label):
        run(['docker','exec',name,'edge-runtime','bundle','--entrypoint','/bos-src/'+slug+'/'+relative(slug),
             '--output','/bos-output/'+slug+'.eszip','--quiet','--timeout','120'], work,label,timeout=150)
        return read(output/(slug+'.eszip'))
    try:
        run(command, work, 'builder-start')
        for slug in overlay.APIS:
            emit('BUILD_BASELINE',slug)
            built = bundle(slug,'baseline-'+slug)
            require(frozen.equal_baseline(read(work/'backup'/('edge/bundles/'+slug+'.eszip')), built),
                    'BASELINE_REBUILD_DIFFERS_'+slug)
        run(['docker','network','disconnect','bridge',name],work,'builder-offline')
        isolated(name,work)
        for slug in overlay.APIS:
            for module in overlay.dependencies(slug):
                atomic(compiler/slug/module, read(work/'candidate'/('edge/sources/'+slug+'/'+module)))
            (output/(slug+'.eszip')).unlink()
            emit('BUILD_PATCHED_OFFLINE',slug)
            built = bundle(slug,'patched-'+slug)
            graph = eszip.parse(built)
            previous = graphs[slug]
            require(graph['npm'] == previous['npm'] and graph['npm_roots'] == previous['npm_roots'], 'DEPENDENCY_DRIFT')
            before, redirects, entry = frozen.executable_modules(previous, slug+'/'+relative(slug))
            after, new_redirects, new_entry = frozen.executable_modules(graph, slug+'/'+relative(slug))
            require(entry == new_entry and redirects == new_redirects and set(before) == set(after), 'MODULE_ROUTING_DRIFT')
            changed = {k for k,v in before.items() if after[k] != v}
            expected = {'/bos-src/'+slug+'/'+n for n in overlay.dependencies(slug)}
            require(changed == expected, 'UNRELATED_MODULE_CHANGED_OR_PRICE_PATCH_MISSING')
            target = work/'candidate'/('edge/bundles/'+slug+'.eszip')
            target.parent.mkdir(parents=True, exist_ok=True)
            atomic(target,built)
    finally:
        remove_container(name,work)


def jwt(role, secret):
    encode = lambda x: base64.urlsafe_b64encode(json.dumps(x,separators=(',',':')).encode()).rstrip(b'=').decode()
    value = encode({'alg':'HS256','typ':'JWT'})+'.'+encode({'role':role,'iss':'supabase','exp':int(time.time())+3600})
    return value+'.'+base64.urlsafe_b64encode(hmac.new(secret.encode(),value.encode(),hashlib.sha256).digest()).rstrip(b'=').decode()


def runtime_test(work, edge):
    main = work/'probe-main'
    shutil.copytree(work/'backup-main',main)
    for path in main.rglob('*.json'):
        if path == main/'routes.json':
            routes = json.loads(read(path))
            require(all(n in routes for n in overlay.APIS), 'REPORT_ROUTES_MISSING')
            atomic(path,json.dumps({n:routes[n] for n in overlay.APIS}).encode())
        elif path == main/'bos-report-env.json':
            atomic(path,json.dumps(dict(version=1,internal='http://127.0.0.1:9000',public=PUBLIC,legacy='',
                workerKey='isolated-report-worker-key-never-production',gas='http://127.0.0.1:19001/gas')).encode())
        else:
            raise Stop('UNRECOGNIZED_GATEWAY_JSON')
    require((main/'bos-report-env.json').is_file(), 'RU_REPORT_GATEWAY_MISSING')
    gateway = read(main/'index.ts').decode()
    lists = re.findall(r'\bconst\s+keys\s*=\s*(\[[^\]]*\])\s*;',gateway)
    require(len(lists) == 1, 'GATEWAY_KEYS_CHANGED')
    keys = []
    for part in lists[0][1:-1].split(','):
        match = re.fullmatch(r'''\s*['"]([A-Z][A-Z0-9_]*)['"]\s*''',part)
        require(match is not None, 'GATEWAY_DYNAMIC_ENV')
        keys.append(match[1])
    env = {k:'isolated-report-value' for k in keys}
    env.update(JWT_SECRET='isolated-report-jwt-secret',VK_APP_SECRET='isolated-report-vk-secret',
               SUPABASE_URL='http://127.0.0.1:9000')
    env['SUPABASE_ANON_KEY'] = jwt('anon',env['JWT_SECRET'])
    env['SUPABASE_SERVICE_ROLE_KEY'] = jwt('service_role',env['JWT_SECRET'])
    for suffix in ('rest','auth','storage'):
        env['BOS_'+suffix.upper()+'_ORIGIN'] = 'http://bos-release-probe-'+suffix+':19001'
    name = 'bos-report-test-'+uuid.uuid4().hex
    args = ['docker','run','-d','--pull=never','--network=none','--name',name,
        '--label','bos.report-submit.stage='+str(work),'--memory=1024m','--memory-swap=1024m',
        '--cpus=1','--pids-limit=256','--user=0:0']
    for suffix in ('rest','auth','storage'):
        args += ['--add-host','bos-release-probe-'+suffix+':127.0.0.1']
    for key,value in env.items():
        args += ['-e',key+'='+value]
    for path,target in [(work/'compiler','/bos-src'),(work/'output','/bos-bundles'),(main,'/bos-main')]:
        args += ['--mount','type=bind,src='+str(path)+',dst='+target+',readonly']
    entry = edge['Config'].get('Entrypoint') or []
    require(len(entry) <= 1 and isinstance(edge['Config'].get('Cmd'),list),'RUNTIME_COMMAND_CHANGED')
    if entry:
        args += ['--entrypoint',entry[0]]
    args += [edge['Image'],*edge['Config']['Cmd']]
    probe = work/'probe.py'
    atomic(probe,read(Path(__file__).parent/'probe.py'))
    try:
        emit('ISOLATED_RUNTIME_TEST')
        run(args,work,'probe-start')
        pid = isolated(name,work)
        config = {'jwt_secret':env['JWT_SECRET'],'vk_secret':env['VK_APP_SECRET']}
        result = json.loads(run(['nsenter','-t',str(pid),'-n',sys.executable,str(probe)],work,
                                'probe-result',timeout=180,data=json.dumps(config).encode()))
        require(result and all(v is True for v in result.values()),'PROBE_INCOMPLETE')
        emit('RUNTIME_TESTS',result)
        return result
    except Stop:
        log = work/'logs/probe-result.log'
        if log.is_file():
            text = read(log).decode(errors='replace')
            for label in re.findall(r'^PROBE_STOP=([A-Z_a-z0-9]+)$',text,re.M):
                emit('PROBE_STOP',label)
        raise
    finally:
        remove_container(name,work)


def save_record(work, record):
    atomic(work/'journal.json',json.dumps(record,ensure_ascii=False,indent=2).encode())


def stage():
    mem = re.search(r'^MemAvailable:\s+(\d+)',Path('/proc/meminfo').read_text(),re.M)
    require(mem and int(mem[1]) > 1800000, 'INSUFFICIENT_AVAILABLE_MEMORY')
    require(shutil.disk_usage(WORK).free > 1500000000,'INSUFFICIENT_DISK')
    edge = host()
    before = snapshot()
    edited, build, old_build = overlay.frontend(LIVE/'web',REPO)
    for name in overlay.APIS:
        overlay.api_ready(name,read(LIVE/source_path(name)))
        for module in overlay.dependencies(name):
            path = 'edge/sources/'+name+'/'+module
            edited[path] = overlay.module(module,read(LIVE/path),REPO)
    require(all(allowed(n) for n in edited),'UNEXPECTED_TARGET')
    work = Path(tempfile.mkdtemp(prefix='stage-',dir=WORK))
    (work/'logs').mkdir()
    emit('STAGE',work.name)
    record = dict(status='preparing',edge=fingerprint(edge),before=before,build=build,old_build=old_build,files={})
    save_record(work,record)
    # Immutable backups of sources and gateway for isolated compilation/testing.
    for name in overlay.APIS:
        shutil.copytree(LIVE/'edge/sources'/name,work/'backup-source'/name)
    shutil.copytree(LIVE/'edge/main',work/'backup-main')
    targets = set(edited) | {'edge/bundles/'+n+'.eszip' for n in overlay.APIS}
    for path in sorted(targets):
        target = work/'backup'/path
        target.parent.mkdir(parents=True,exist_ok=True)
        atomic(target,read(LIVE/path))
        record['files'][path] = {'before':item(LIVE/path)}
    for path,data in edited.items():
        target = work/'candidate'/path
        target.parent.mkdir(parents=True,exist_ok=True)
        atomic(target,data)
    save_record(work,record)
    compile_apis(work,edge)
    result = runtime_test(work,edge)
    require(snapshot() == before and fingerprint(host()) == record['edge'],'CONCURRENT_PRODUCTION_CHANGE')
    for path,info in record['files'].items():
        info['after'] = sha(read(work/'candidate'/path))
    record.update(status='verified',tests=result)
    save_record(work,record)
    atomic(WORK/'current.json',json.dumps({'stage':work.name}).encode())
    emit('STAGE_READY',True)
    emit('PRODUCTION_CHANGED',False)
    emit('BUILD_ID',build)


def selected():
    value = json.loads(read(WORK/'current.json'))['stage']
    require(re.fullmatch('stage-[A-Za-z0-9_-]+',value),'STAGE_PATH_INVALID')
    work = WORK/value
    require(work.resolve() == work and work.is_dir(),'STAGE_PATH_UNSAFE')
    record = json.loads(read(work/'journal.json'))
    expected = module_paths() | {'edge/bundles/'+n+'.eszip' for n in overlay.APIS}
    manifest = read(work/'backup/web/build-version.js')
    match = re.fullmatch(rb'// Generated by npm run build\. Do not edit\.\nself\.BOS_BUILD=(\{.*\});\n',manifest,re.S)
    require(match is not None,'STAGE_MANIFEST_FORMAT')
    routes = json.loads(match[1]).get('assetBundles',{})
    bundles = {routes.get(n) for n in overlay.WEB}
    require(bundles and bundles <= {'startup-shell.bundle.js','startup-eager.bundle.js'},'STAGE_BUNDLE_ROUTES')
    expected |= {'web/'+n for n in (*bundles,'index.html','sw.js','build-version.js')}
    require(expected <= set(record['files']) and all(allowed(p) for p in record['files']),'STAGE_TARGETS_CHANGED')
    for path,info in record['files'].items():
        require(sha(read(work/'backup'/path)) == info['before']['sha'],'BACKUP_CHANGED')
        require(sha(read(work/'candidate'/path)) == info['after'],'CANDIDATE_CHANGED')
    return work,record


def public_matches(work, record, which):
    for path,info in record['files'].items():
        if not path.startswith('web/'):
            continue
        request = Request(PUBLIC+'/'+path.removeprefix('web/')+'?bos-report='+record['build'],
                          headers={'Cache-Control':'no-cache'})
        try:
            with urlopen(request,timeout=20) as response:
                require(response.status == 200,'PUBLIC_HTTP_STATUS')
                data = response.read(16000001)
        except Stop:
            raise
        except Exception:
            raise Stop('PUBLIC_CHECK_UNAVAILABLE') from None
        expected = info['before']['sha'] if which == 'before' else info['after']
        require(len(data) <= 16000000 and sha(data) == expected,'PUBLIC_ASSET_DIFFERS')


def health(work):
    edge = host()
    code = '''import json,time
from urllib.request import build_opener,ProxyHandler,Request
from urllib.error import HTTPError
opener=build_opener(ProxyHandler({}))
for attempt in range(20):
 try:
  request=Request('http://127.0.0.1:9000/functions/v1/order-lifecycle-api',data=b'{"action":"health"}',headers={'Content-Type':'application/json'})
  with opener.open(request,timeout=3) as r:
   assert r.status==200 and json.load(r).get('ok') is True
  request=Request('http://127.0.0.1:9000/functions/v1/report-api',data=b'{"action":"finalizeMasterReport"}',headers={'Content-Type':'application/json'})
  try: opener.open(request,timeout=3)
  except HTTPError as e: assert e.code in (401,403)
  else: raise AssertionError('auth')
  print('HEALTH_AND_AUTH_OK');break
 except Exception:
  if attempt==19: raise SystemExit(1)
  time.sleep(.5)
'''
    run(['nsenter','-t',str(edge['State']['Pid']),'-n',sys.executable,'-c',code],work,'health',timeout=90)


def restore(work,record):
    for path,info in record['files'].items():
        current = item(LIVE/path)
        require(current and current['sha'] in (info['before']['sha'],info['after']), 'ROLLBACK_CONCURRENT_CHANGE')
    for path,info in reversed(list(record['files'].items())):
        atomic(LIVE/path,read(work/'backup'/path),info['before'])
    run(['docker','restart','--time=10',EDGE],work,'rollback-restart',timeout=60)
    health(work)
    public_matches(work,record,'before')
    record['status'] = 'rolled_back'
    save_record(work,record)
    emit('API_WEB_ROLLED_BACK',True)


def apply(rollback=False):
    work,record = selected()
    require(fingerprint(host()) == record['edge'],'EDGE_CONFIG_CHANGED')
    if rollback:
        require(record['status'] in ('applying','applied','rollback_required'),'NOT_APPLIED')
        restore(work,record)
        return
    if record['status'] == 'applied':
        require(all(item(LIVE/p)['sha'] == i['after'] for p,i in record['files'].items()),'INSTALLED_FILES_CHANGED')
        health(work)
        public_matches(work,record,'after')
        emit('ALREADY_APPLIED',True)
        return
    require(record['status'] == 'verified' and record.get('tests') and all(record['tests'].values()),'STAGE_NOT_VERIFIED')
    require(snapshot() == record['before'],'LIVE_RELEASE_CHANGED')
    public_matches(work,record,'before')
    record['status'] = 'applying'
    save_record(work,record)
    try:
        api = sorted(p for p in record['files'] if p.startswith('edge/'))
        web = sorted(p for p in record['files'] if p.startswith('web/') and not p.endswith('build-version.js'))
        for path in api:
            atomic(LIVE/path,read(work/'candidate'/path),record['files'][path]['before'])
        run(['docker','restart','--time=10',EDGE],work,'edge-restart',timeout=60)
        health(work)
        for path in web+['web/build-version.js']:
            atomic(LIVE/path,read(work/'candidate'/path),record['files'][path]['before'])
        public_matches(work,record,'after')
        record['status'] = 'applied'
        save_record(work,record)
        emit('API_WEB_APPLIED',True)
        emit('BUILD_ID',record['build'])
        emit('BACKUP',str(work))
    except Exception:
        record['status'] = 'rollback_required'
        save_record(work,record)
        try:
            restore(work,record)
        except Exception:
            emit('ROLLBACK_REQUIRED',True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('stage','apply','rollback'))
    args = parser.parse_args()
    require(os.geteuid() == 0,'ROOT_REQUIRED')
    os.umask(0o077)
    WORK.mkdir(mode=0o700,exist_ok=True)
    require(WORK.resolve() == WORK and not WORK.is_symlink(),'WORK_PATH_UNSAFE')
    with (WORK/'.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if args.action == 'stage':
            stage()
        else:
            apply(args.action == 'rollback')


if __name__ == '__main__':
    try:
        main()
    except Stop as error:
        emit('STOP',str(error))
        sys.exit(1)
    except Exception as error:
        emit('STOP',type(error).__name__)
        sys.exit(1)
