"""Pinned order intake API rollout using the existing RU edge container."""
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

STAGE = f.PARENT/'lemana-297-api'
MOUNTS = {'sources':'/bos-src', 'bundles':'/bos-bundles', 'main':'/bos-main'}

def resource(name):
    import zipfile
    root=Path(__file__).parent
    if root.is_dir(): return (root/name).read_bytes()
    with zipfile.ZipFile(root) as z: return z.read(name)

def payload():
    spec=json.loads(resource('backend.json'))
    data={n:resource('backend/'+n) for n in spec['after']}
    f.require(all(f.sha(b)==spec['after'][n] for n,b in data.items()),'Damaged backend payload')
    return spec,data

SPEC=json.loads(resource('backend.json'))
HANDLERS=SPEC['handlers']
TARGETS={'sources':set(SPEC['after']),'bundles':{n+'.eszip' for n in HANDLERS}}
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
    for name,digest in SPEC['before'].items():
        path=Path(roots['sources'])/name
        if digest is None: f.require(not path.exists(),'New backend filename already exists: '+name)
        else: f.require(path.is_file() and f.sha(path.read_bytes())==digest,'Backend baseline differs: '+name)
    for name in HANDLERS:
        path=Path(roots['bundles'])/(name+'.eszip')
        f.require(path.is_file() and path.stat().st_size>64,'Missing reviewed handler bundle: '+name)
    verify_mounts(edge['Id'],roots,before)
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
    f.emit('BACKEND_BASELINE_OK handlers='+str(len(HANDLERS)))
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


def verify_mounts(container,roots,snapshots):
    for folder,names in TARGETS.items():
        for name in sorted(names):
            if name not in snapshots[folder]: continue
            actual=f.command(['docker','exec',container,'sha256sum',MOUNTS[folder]+'/'+name]).decode().split()[0]
            f.require(actual==snapshots[folder][name]['sha256'],'Container mount differs: '+folder+'/'+name)


def check(rec,phase='either'):
    edge=f.inspect(rec['container'])
    f.require(f.fingerprint(edge)==rec['fingerprint'],'Edge container configuration changed')
    for folder,path in rec['roots'].items():
        actual=f.snapshot(Path(path));allowed=[rec['before'][folder]]
        if 'after' in rec:
            if phase=='after': allowed=[rec['after'][folder]]
            elif phase=='either': allowed.append(rec['after'][folder])
        f.require(actual in allowed,'Edge directory changed outside release states: '+folder)
    return edge


def checked_payload(rec):
    for folder in MOUNTS:
        f.require(f.snapshot(STAGE/'backup'/folder)==rec['before'][folder],'Backend backup changed: '+folder)
        if 'after' in rec:
            f.require(f.snapshot(STAGE/folder) in [rec['before'][folder],rec['after'][folder]],'Backend swap directory changed: '+folder)


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
    ids=f.command(['docker','ps','-aq','--filter','label=bos.lemana297='+nonce]).decode().split()
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


def original_build_cache(rec):
    # PR296 cache was used for the active mini bundle. Reproduce every bundle
    # byte-for-byte below before changing any source; never resolve online.
    previous=f.PARENT/'intake-296-api'
    journal=previous/'journal.json'
    f.require(previous.resolve()==previous and journal.is_file() and not journal.is_symlink(),'Reviewed PR296 build journal missing')
    old=json.loads(journal.read_text())
    f.require(old['image']==rec['image'] and old['state']=='active','PR296 compiler image/journal mismatch')
    expected=rec['before']['bundles']['mini-app-api.eszip']['sha256']
    f.require(old['after']['bundles']['mini-app-api.eszip']['sha256']==expected,'PR296 cached bundle differs')
    cache=previous/'cache';f.snapshot(cache)
    return cache


def install_sources(data):
    root=STAGE/'sources';owner=(root/'mini-app-api/order-payroll.js').stat()
    for name,content in data.items():
        parent=(root/name).parent
        if not parent.exists():
            f.require(parent.parent.is_dir(),'Unexpected new directory depth')
            parent.mkdir(mode=0o755);os.chown(parent,owner.st_uid,owner.st_gid)
        f.write_candidate(root,name,content,owner)


def compile_candidate(rec,patched=None):
    spec,data=payload()
    cache=original_build_cache(rec);cache_before=f.snapshot(cache)
    size=sum(v.get('size',0) for v in cache_before.values())
    f.require(shutil.disk_usage(f.PARENT).free>size*2+256*1024*1024,'Insufficient cache staging disk space')
    f.copy_tree(cache,STAGE/'cache');f.require(f.snapshot(STAGE/'cache')==cache_before,'Build cache copy differs')
    output=STAGE/'output';output.mkdir()
    args=['docker','run','-d','--pull=never','--network','none','--label','bos.lemana297='+rec['nonce'],
          '--name','bos-lemana297-build-'+rec['nonce'],*LIMITS,'--read-only',
          '--tmpfs','/tmp:rw,nosuid,size=128m','--env','DENO_DIR=/bos-cache','--entrypoint','/bin/sh',
          '--mount','type=bind,src='+str(STAGE/'sources')+',dst=/bos-src,readonly',
          '--mount','type=bind,src='+str(STAGE/'cache')+',dst=/bos-cache',
          '--mount','type=bind,src='+str(output)+',dst=/bos-bundles',rec['image'],'-c','while :; do sleep 1; done']
    try:
        cid=private_command(args,'build-start').decode().strip();assert_isolated(cid)
        def build(name,label):
            f.emit(label.upper()+' '+name)
            private_command(['docker','exec',cid,'edge-runtime','bundle','--entrypoint',
                '/bos-src/'+name+'/supabase/functions/'+name+'/index.ts','--output','/bos-bundles/'+name+'.eszip','--timeout','300'],
                label+'-'+name,timeout=330)
            return output/(name+'.eszip')
        for name in HANDLERS:
            built=build(name,'baseline-build')
            f.require(f.sha(built.read_bytes())==rec['before']['bundles'][name+'.eszip']['sha256'],'Baseline bundle rebuild differs: '+name)
            built.unlink()
        f.emit('ALL_BASELINES_REPRODUCED; building candidates offline...')
        install_sources(data)
        for name in HANDLERS:
            built=build(name,'candidate-build')
            f.require(built.is_file() and built.stat().st_size>64,'Empty candidate bundle: '+name)
            shutil.copyfile(built,STAGE/'bundles'/(name+'.eszip'))
    finally:
        try:cleanup(rec)
        finally:f.require(f.snapshot(cache)==cache_before,'Original build cache changed')


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
            good=response.status in (200,204) and 'POST' in response.headers.get('Access-Control-Allow-Methods','')
            allowed=response.headers.get('Access-Control-Allow-Headers','').lower()
            good=good and all(x in allowed for x in ['content-type','x-bos-session'])
            if d['cors']: good=good and response.headers.get('Access-Control-Allow-Origin') in (d['origin'],'*')
    except Exception: good=False
    for action,status in [('health',200),('createOrder',401),('updateOrder',401),('previewLemanaImport',401),('confirmLemanaImport',401)]:
        req=urllib.request.Request(d['base']+path,data=json.dumps({'action':action}).encode(),
            headers={'Content-Type':'application/json','Origin':d['origin']},method='POST')
        try:
            try: response=opener.open(req,timeout=4)
            except urllib.error.HTTPError as e: response=e
            with response:
                body=json.loads(response.read(8192))
                valid=response.status==status
                if action=='health': valid=valid and body.get('ok') is True and body.get('version')=='2026-09-12-team-critical-v13'
                else: valid=valid and body.get('ok') is False and body.get('error')=='Доступ не подтверждён'
                if d['cors']: valid=valid and response.headers.get('Access-Control-Allow-Origin') in (d['origin'],'*')
                good=good and valid
        except Exception: good=False
    results.append({'path':path,'ok':good})
print(json.dumps(results))
'''


def probe(rec,*,pid=None,public=False,cors=True):
    data=dict(base=ORIGIN if public else 'http://127.0.0.1:9000',origin=ORIGIN,cors=cors,
              paths=['/functions/v1/mini-app-api'])
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
    args=['docker','run','-d','--pull=never','--network','none','--label','bos.lemana297='+rec['nonce'],
          '--name','bos-lemana297-test-'+rec['nonce'],*LIMITS]
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
        raise f.Stop('Isolated intake health/auth/CORS probe failed')
    finally: cleanup(rec)


def probe_live(rec,cors=True):
    for attempt in range(6):
        edge=check(rec)
        if edge['State']['Running'] and probe(rec,pid=edge['State']['Pid'],cors=cors) and probe(rec,public=True,cors=cors):
            return
        time.sleep(1)
    raise f.Stop('Live intake health/auth/CORS probe failed')


def prepare(info,patched=None):
    f.require(not STAGE.exists(),'Backend stage already exists; inspect --check / --rollback')
    rec={**info,'main_sha':f.MAIN,'nonce':uuid.uuid4().hex,'state':'preparing'}
    check(rec,'before');STAGE.mkdir(mode=0o700);sync_dir(STAGE.parent)
    f.require(all(Path(p).stat().st_dev==STAGE.stat().st_dev for p in info['roots'].values()),'Backend must share staging filesystem')
    save(rec);(STAGE/'backup').mkdir(mode=0o700)
    for folder,path in info['roots'].items():
        f.copy_tree(Path(path),STAGE/'backup'/folder);f.copy_tree(Path(path),STAGE/folder)
        f.require(f.snapshot(STAGE/folder)==rec['before'][folder],'Backend copy mismatch')
    f.fsync_tree(STAGE/'backup');checked_payload(rec);probe_live(rec,cors=False)
    compile_candidate(rec)
    after={folder:f.snapshot(STAGE/folder) for folder in MOUNTS}
    for folder,before in rec['before'].items():
        new=after[folder];allowed=TARGETS.get(folder,set())
        added=set(new)-set(before)
        allowed_added={n for n in allowed if n not in before}
        for name in list(allowed_added):
            parent=str(Path(name).parent)
            if parent not in before:allowed_added.add(parent)
        f.require(set(before)<=set(new) and added==allowed_added,'Candidate backend file set differs')
        for name,value in before.items():
            if name in allowed:
                f.require(all(new[name][k]==value[k] for k in ['mode','uid','gid','type']),'Backend metadata changed')
            else:f.require(new[name]==value,'Unrelated backend candidate changed: '+folder+'/'+name)
    rec['after']=after;checked_payload(rec);probe_candidate(rec);check(rec,'before')
    for folder in MOUNTS:f.fsync_tree(STAGE/folder)
    rec['state']='prepared';save(rec);return rec


def restart(rec,phase):
    check(rec,phase);f.emit('Restarting the existing edge container...')
    f.command(['docker','restart','--time','10',rec['container']],timeout=60)
    edge=check(rec,phase);f.require(edge['State']['Running'],'Edge did not restart')
    verify_mounts(rec['container'],rec['roots'],rec[phase])


def activate(rec):
    f.require(rec['state']=='prepared','Backend was not prepared')
    checked_payload(rec);check(rec,'before');rec['state']='activating';save(rec)
    for folder in TARGETS:
        f.exchange(Path(rec['roots'][folder]),STAGE/folder);sync_dir(Path(rec['roots'][folder]).parent);sync_dir(STAGE)
    check(rec,'after');restart(rec,'after');probe_live(rec)
    rec['state']='active';save(rec);f.emit('LEMANA_API_DEPLOYED; all other handler sources and credentials retained')


def restore(rec):
    checked_payload(rec);check(rec)
    rec['state']='rolling_back';save(rec)
    for folder in TARGETS:
        root=Path(rec['roots'][folder])
        if f.snapshot(root)!=rec['before'][folder]:
            f.require(f.snapshot(STAGE/folder)==rec['before'][folder],'Previous backend swap changed')
            f.exchange(root,STAGE/folder);sync_dir(root.parent);sync_dir(STAGE)
    check(rec,'before');restart(rec,'before');probe_live(rec,cors=False)
    rec['state']='rolled_back';save(rec);cleanup(rec);f.emit('BACKEND_ROLLED_BACK; additive database data retained')
