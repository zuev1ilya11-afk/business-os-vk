"""Narrow CORS-only push-api rollout using the existing RU edge container."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
import uuid
import frontend as f

STAGE = f.PARENT/'pr289-api'
SOURCE_BEFORE = '6bd9d08bf8615854f5e5ce8c475869f9e6bb11f5b9c3fa2adcaa1cad33cb7113'
SOURCE_AFTER = '974b7078e0448ed830ec28f82392ef4f3304687e631112983fd6bd400c076869'
MOUNTS = {'sources':'/bos-src', 'bundles':'/bos-bundles', 'main':'/bos-main'}
TARGETS = {'sources':'push-api/index.ts', 'bundles':'push-api.eszip'}
LIMITS = ['--memory','512m','--memory-swap','512m','--cpus','1','--pids-limit','256','--user','0:0']
ORIGIN = 'https://139.100.237.167'


def discover(web_root):
    ids=f.command(['docker','ps','-q']).decode().split()
    containers=json.loads(f.command(['docker','inspect',*ids]))
    matches=[c for c in containers if c['Name'].startswith('/bos-release-') and c['Name'].endswith('-edge')]
    f.require(len(matches)==1,'Expected exactly one active RU edge container')
    edge=matches[0]
    roots={}
    for folder,dest in MOUNTS.items():
        mounts=[m for m in edge['Mounts'] if m['Destination']==dest and m['Type']=='bind']
        f.require(len(mounts)==1,'Missing edge bind: '+dest)
        root=Path(mounts[0]['Source'])
        # Existing RU layout: release-*/web and release-*/edge/{sources,bundles,main}.
        f.require(root.resolve()==root and root==web_root.parent/'edge'/folder,
                  'Edge and web release paths disagree')
        f.require(not any(m['Destination'].startswith(dest+'/') for m in edge['Mounts']),
                  'Unexpected nested edge mount')
        roots[folder]=str(root)
    f.require(len(set(roots.values()))==3,'Edge mounts overlap')
    before={k:f.snapshot(Path(p)) for k,p in roots.items()}
    source=Path(roots['sources'])/TARGETS['sources']
    bundle=Path(roots['bundles'])/TARGETS['bundles']
    f.require(f.sha(source.read_bytes())==SOURCE_BEFORE,'Live push-api source is not the reviewed baseline')
    f.require(bundle.is_file() and bundle.stat().st_size>64,'Missing active push bundle')
    for folder in TARGETS:
        digest=before[folder][TARGETS[folder]]['sha256']
        actual=f.command(['docker','exec',edge['Id'],'sha256sum',MOUNTS[folder]+'/'+TARGETS[folder]]).decode().split()[0]
        f.require(actual==digest,'Edge mount differs from host: '+folder)
    gateway='\n'.join(p.read_text() for p in Path(roots['main']).rglob('*.ts'))
    f.require(all(s in gateway for s in ['/bos-bundles/','.eszip','Deno.serve']), 'Unknown edge routing layout')
    f.require(not re.search(r'\b(setInterval|Deno\.Command|Deno\.run)\s*\(',gateway),
              'Gateway background/process code requires review')
    env={'SUPABASE_URL':'http://127.0.0.1:1','SUPABASE_ANON_KEY':'isolated-no-database-access',
         'SUPABASE_SERVICE_ROLE_KEY':'isolated-no-database-access',
         'JWT_SECRET':'isolated-key-not-valid-in-production',
         'VK_APP_SECRET':'isolated-key-not-valid-in-production'}
    real_env=dict(x.split('=',1) for x in edge['Config'].get('Env',[]) if '=' in x)
    # The unchanged gateway validates these private upstreams during startup.
    # Preserve only bare service origins; credentials stay dummy and the probe
    # retains --network=none, with loopback-only interfaces verified separately.
    for name in ('BOS_AUTH_ORIGIN','BOS_REST_ORIGIN','BOS_STORAGE_ORIGIN'):
        value=real_env.get(name,'')
        try:
            url=urllib.parse.urlsplit(value)
            valid=(bool(value) and not any(c.isspace() for c in value) and
                   url.scheme in ('http','https') and bool(url.hostname) and
                   url.username is None and url.password is None and
                   url.path in ('','/') and '?' not in value and '#' not in value and
                   (url.port is None or 1<=url.port<=65535))
        except ValueError:
            valid=False
        f.require(valid,'Expected credential-free base URL: '+name)
        env[name]=value
    names=set(re.findall(r'Deno\.env\.get\(\s*[\'"]([A-Z][A-Z0-9_]{0,79})[\'"]\s*\)',gateway))
    f.require(not names-set(env),'Unreviewed gateway environment names: '+','.join(sorted(names-set(env))))
    f.require(all(real_env.get(n) for n in names|{'SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','VK_APP_SECRET'}),
              'Active edge environment is incomplete')
    f.emit('PUSH_SOURCE_BEFORE='+SOURCE_BEFORE)
    return dict(container=edge['Id'],fingerprint=f.fingerprint(edge),image=edge['Image'],
                config={k:edge['Config'].get(k) for k in ['Entrypoint','Cmd']},
                roots=roots,before=before,environment=env)


def save(rec):
    path=STAGE/'journal.tmp'
    with open(path,'w') as out:
        os.chmod(path,0o600)
        json.dump(rec,out,indent=2)
        out.flush(); os.fsync(out.fileno())
    os.replace(path,STAGE/'journal.json')
    sync_dir(STAGE)


def sync_dir(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)


def check(rec,phase='either'):
    edge=f.inspect(rec['container'])
    f.require(f.fingerprint(edge)==rec['fingerprint'],'Edge container configuration changed')
    for folder,path in rec['roots'].items():
        actual=f.snapshot(Path(path))
        before=rec['before'][folder]
        f.require(actual.keys()==before.keys(),'Edge file set changed: '+folder)
        for name,value in actual.items():
            allowed=[before[name]]
            if folder in TARGETS and name==TARGETS[folder] and 'after' in rec:
                new=rec['after'][folder][name]
                if phase=='after': allowed=[new]
                elif phase=='either': allowed.append(new)
            f.require(value in allowed,'Edge file changed outside allowed release state: '+folder+'/'+name)
    return edge


def checked_payload(rec):
    for folder,name in TARGETS.items():
        backup=STAGE/'backup'/Path(name).name
        f.require(backup.is_file() and not backup.is_symlink() and
                  f.sha(backup.read_bytes())==rec['before'][folder][name]['sha256'],
                  'Backend backup changed: '+name)
        if 'after' in rec:
            p=STAGE/folder/name
            f.require(p.is_file() and not p.is_symlink() and f.sha(p.read_bytes())==rec['after'][folder][name]['sha256'],
                      'Backend candidate changed: '+name)


def private_command(args,label,timeout=60,input_data=None):
    try: result=subprocess.run(args,input=input_data,capture_output=True,timeout=timeout)
    except (OSError,subprocess.SubprocessError): raise f.Stop(label+': unavailable or timed out') from None
    path=STAGE/(label+'.log')
    path.write_bytes(result.stdout+b'\n'+result.stderr)
    os.chmod(path,0o600)
    f.require(result.returncode==0,label+': failed; details saved privately in '+str(path))
    return result.stdout


def cleanup(rec):
    nonce=rec['nonce']
    f.require(re.fullmatch('[a-f0-9]{32}',nonce),'Invalid temporary container marker')
    ids=f.command(['docker','ps','-aq','--filter','label=bos.pr289='+nonce]).decode().split()
    if ids: f.command(['docker','rm','-f',*ids])


def assert_isolated(cid):
    info=f.inspect(cid)
    f.require(info['State']['Running'] and info['State']['Pid']>0,'Temporary runtime is not running')
    f.require(not info['NetworkSettings']['Networks'] or set(info['NetworkSettings']['Networks'])=={'none'},
              'Temporary runtime has an external Docker network')
    interfaces=private_command(['nsenter','-t',str(info['State']['Pid']),'-n',sys.executable,'-c',
        'import socket,json; print(json.dumps([n for _,n in socket.if_nameindex()]))'],'interfaces')
    f.require(json.loads(interfaces)==['lo'],'Temporary runtime has an external interface')
    return info['State']['Pid']


def compile_candidate(rec,patched):
    output=STAGE/'output'; output.mkdir()
    args=['docker','run','-d','--pull=never','--network','bridge','--label','bos.pr289='+rec['nonce'],
          '--name','bos-pr289-build-'+rec['nonce'],*LIMITS,'--entrypoint','/bin/sh',
          '--mount','type=bind,src='+str(STAGE/'sources')+',dst=/bos-src,readonly',
          '--mount','type=bind,src='+str(output)+',dst=/bos-output',rec['image'],
          '-c','while :; do sleep 1; done']
    try:
        cid=private_command(args,'build-start').decode().strip()
        build=['docker','exec',cid,'edge-runtime','bundle','--entrypoint','/bos-src/push-api/index.ts',
               '--output','/bos-output/push-api.eszip','--quiet','--timeout','90']
        private_command(build,'baseline-build',timeout=120)
        built=output/'push-api.eszip'
        f.require(f.sha(built.read_bytes())==rec['before']['bundles']['push-api.eszip']['sha256'],
                  'Baseline bundle rebuild differs; production unchanged')
        f.command(['docker','network','disconnect','bridge',cid])
        assert_isolated(cid)
        (STAGE/'sources/push-api/index.ts').write_bytes(patched)
        built.unlink()
        private_command(build,'patched-build',timeout=120)
        f.require(built.is_file() and built.stat().st_size>64,'Compiled push bundle is empty')
        shutil.copyfile(built,STAGE/'bundles/push-api.eszip')
    finally: cleanup(rec)


PROBE = r'''
import json,sys,urllib.request,urllib.error
d=json.load(sys.stdin)
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): return None
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
results=[]
for path in d['paths']:
    good=True
    req=urllib.request.Request(d['base']+path,method='OPTIONS',headers={'Origin':d['origin'],
        'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-bos-session'})
    try:
        with opener.open(req,timeout=4) as response:
            good=response.status==204 and 'POST' in response.headers.get('Access-Control-Allow-Methods','')
            allowed=response.headers.get('Access-Control-Allow-Headers','').lower()
            good=good and all(x in allowed for x in ['content-type','x-bos-session'])
            if d['cors']: good=good and response.headers.get('Access-Control-Allow-Origin') in (d['origin'],'*')
    except Exception: good=False
    for action,status in [('health',200),('status',401)]:
        req=urllib.request.Request(d['base']+path,data=json.dumps({'action':action}).encode(),
            headers={'Content-Type':'application/json','Origin':d['origin']},method='POST')
        try:
            try: response=opener.open(req,timeout=4)
            except urllib.error.HTTPError as e: response=e
            with response:
                body=json.loads(response.read(8192))
                valid=response.status==status
                if action=='health': valid=valid and body.get('ok') is True and body.get('service')=='push-api' and body.get('version')=='web-push-v211-control-v2'
                else: valid=valid and body.get('ok') is False and body.get('error')=='Войдите в приложение заново.'
                if d['cors']: valid=valid and response.headers.get('Access-Control-Allow-Origin') in (d['origin'],'*')
                good=good and valid
        except Exception: good=False
    results.append({'path':path,'ok':good})
print(json.dumps(results))
'''


def probe(rec,*,pid=None,public=False,cors=True):
    data=dict(base=ORIGIN if public else 'http://127.0.0.1:9000',origin=ORIGIN,cors=cors,
              paths=['/functions/v1/push-api'])
    args=[sys.executable,'-c',PROBE]
    if not public:
        f.require(type(pid) is int and pid>0,'Running edge PID required')
        args=['nsenter','-t',str(pid),'-n',*args]
    result=json.loads(private_command(args,'public-probe' if public else 'private-probe',timeout=40,
                                     input_data=json.dumps(data).encode()))
    # The unchanged RU fetch adapter rewrites legacy /api/proxy/ URLs to this
    # effective route. The gateway itself does not implement that legacy alias.
    return all(x['ok'] for x in result)


def probe_candidate(rec):
    config=rec['config']
    entry=config.get('Entrypoint') or []
    f.require(len(entry)<=1,'Compound edge entrypoint requires review')
    args=['docker','run','-d','--pull=never','--network','none','--label','bos.pr289='+rec['nonce'],
          '--name','bos-pr289-test-'+rec['nonce'],*LIMITS]
    for name,value in rec['environment'].items(): args+=['-e',name+'='+value]
    for folder,dest in MOUNTS.items():
        args+=['--mount','type=bind,src='+str(STAGE/folder)+',dst='+dest+',readonly']
    if entry: args+=['--entrypoint',entry[0]]
    args+=[rec['image'],*(config.get('Cmd') or [])]
    try:
        cid=private_command(args,'candidate-start').decode().strip()
        for attempt in range(6):
            pid=assert_isolated(cid)
            if probe(rec,pid=pid): return
            time.sleep(1)
        raise f.Stop('Isolated push health/auth/CORS probe failed')
    finally: cleanup(rec)


def probe_live(rec,cors=True):
    for attempt in range(6):
        edge=check(rec)
        if edge['State']['Running'] and probe(rec,pid=edge['State']['Pid'],cors=cors) and probe(rec,public=True,cors=cors):
            return
        time.sleep(1)
    raise f.Stop('Live push health/auth/CORS probe failed')


def prepare(info,patched):
    f.require(f.sha(patched)==SOURCE_AFTER and
              f.sha(patched.replace(b"'https://139.100.237.167',",b''))==SOURCE_BEFORE,
              'Patch differs from approved CORS-only change')
    f.require(not STAGE.exists(),'Backend staging directory already exists; inspect --check / --rollback')
    rec={**info,'main_sha':f.MAIN,'nonce':uuid.uuid4().hex,'state':'preparing'}
    check(rec,'before')
    STAGE.mkdir(mode=0o700)
    sync_dir(STAGE.parent)
    f.require(all(Path(p).stat().st_dev==STAGE.stat().st_dev for p in info['roots'].values()),
              'Backend paths must share the staging filesystem')
    save(rec)
    (STAGE/'backup').mkdir(mode=0o700)
    for folder,path in info['roots'].items():
        f.copy_tree(Path(path),STAGE/folder)
        f.require(f.snapshot(STAGE/folder)==info['before'][folder],'Backend copy mismatch: '+folder)
        if folder in TARGETS:
            shutil.copy2(Path(path)/TARGETS[folder],STAGE/'backup'/Path(TARGETS[folder]).name)
    f.fsync_tree(STAGE/'backup')
    checked_payload(rec)
    probe_live(rec,cors=False)
    f.emit('Building and comparing the baseline push bundle...')
    compile_candidate(rec,patched)
    after={folder:f.snapshot(STAGE/folder) for folder in MOUNTS}
    for folder,before in rec['before'].items():
        f.require(after[folder].keys()==before.keys(),'Candidate backend file set changed')
        for name,value in before.items():
            new=after[folder][name]
            if TARGETS.get(folder)==name:
                f.require(all(new[k]==value[k] for k in ['mode','uid','gid','type']), 'Backend metadata changed')
            else: f.require(new==value,'Unrelated backend candidate changed: '+folder+'/'+name)
    rec['after']=after
    checked_payload(rec)
    f.emit('Checking isolated push runtime without production credentials...')
    probe_candidate(rec)
    check(rec,'before')
    f.fsync_tree(STAGE)
    rec['state']='prepared'; save(rec)
    return rec


def replace_target(rec,folder,data):
    name=TARGETS[folder]
    target=Path(rec['roots'][folder])/name
    entry=rec['before'][folder][name]
    temp=STAGE/'replacement.tmp'
    fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as out:
        out.write(data); out.flush()
        os.fchmod(out.fileno(),entry['mode']); os.fchown(out.fileno(),entry['uid'],entry['gid'])
        os.fsync(out.fileno())
    os.replace(temp,target)
    sync_dir(target.parent); sync_dir(STAGE)


def restart(rec):
    check(rec)
    f.emit('Restarting only the existing edge container...')
    f.command(['docker','restart','--time','10',rec['container']],timeout=60)
    edge=check(rec)
    f.require(edge['State']['Running'],'Edge did not restart')


def activate(rec):
    f.require(rec['state']=='prepared','Backend was not prepared')
    checked_payload(rec); check(rec,'before')
    rec['state']='activating'; save(rec)
    for folder,name in TARGETS.items(): replace_target(rec,folder,(STAGE/folder/name).read_bytes())
    check(rec,'after')
    restart(rec); probe_live(rec)
    rec['state']='active'; save(rec)
    f.emit('PUSH_CORS_DEPLOYED; credentials and all other handlers preserved')


def restore(rec):
    checked_payload(rec); check(rec)
    if rec['state']=='prepared':
        check(rec,'before')
        rec['state']='rolled_back'; save(rec)
        f.emit('PUSH_NOT_ACTIVATED; original backend retained')
        return
    rec['state']='rolling_back'; save(rec)
    for folder,name in TARGETS.items():
        target=Path(rec['roots'][folder])/name
        before=rec['before'][folder][name]['sha256']
        if f.sha(target.read_bytes())!=before:
            replace_target(rec,folder,(STAGE/'backup'/Path(name).name).read_bytes())
    check(rec,'before')
    restart(rec); probe_live(rec,cors=False)
    rec['state']='rolled_back'; save(rec)
    f.emit('PUSH_CORS_ROLLED_BACK')
