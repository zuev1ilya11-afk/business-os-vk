#!/usr/bin/env python3
"""Activate the hash-verified report candidate; restore files on failed checks.

Never restores an old production database or deletes archive jobs. --rollback
restores only files from this installer's last journal and stops its worker.
"""
import argparse
import base64
import fcntl
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import posixpath
import re
import stat
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError
from urllib.parse import parse_qs, quote, unquote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

RUNTIME_SHA = '88bd6318db3cb07883b296fafea83f4f6992661d63c645291f8977180c65f3fc'
PUBLIC = 'https://homemaster.qd.je'
GAS = 'https://script.google.com/macros/s/AKfycbx6l6V_jjZdbWQGljODcR4Uf4wvMc8hA24Dulzdmi-Ek76QH1mQS0tm3Q_ErI1sWEumzQ/exec'
MIGRATION = 'supabase/migrations/20261030090000_report_archive_queue.sql'
WORKER = Path('/opt/business-os/report-acceptance/archive-worker.py')
WORKER_ENV = Path('/etc/business-os/drive-worker.env')
UNITS = ('bos-drive-archive.service', 'bos-drive-archive.timer')
s = v = r = None


def require(condition, label):
    if not condition:
        raise RuntimeError(label)


def load_helpers():
    path = Path('/tmp/bos-r2.py')
    require(path.resolve()==path and hashlib.sha256(path.read_bytes()).hexdigest()==RUNTIME_SHA,
            'RUNTIME_HELPER_CHANGED')
    spec = importlib.util.spec_from_file_location('bos_activation_runtime', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.s, module.v = module.load_helpers()
    return module.s, module.v, module


def atomic_file(path, data, mode, uid=0, gid=0):
    require(path.is_absolute() and path.resolve()==path, 'INSTALL_PATH_UNSAFE')
    path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix='.bos-install-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as out:
            out.write(data)
            os.fchown(out.fileno(), uid, gid)
            os.fchmod(out.fileno(), mode)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def save(work, journal, phase):
    journal['phase'] = phase
    atomic_file(work/'activation.json', json.dumps(journal, indent=2).encode(), 0o600)


def changed_files(before, after, allowed):
    require(set(before)<=set(after), 'CANDIDATE_DELETES_FILES')
    changed = [name for name in sorted(after) if before.get(name)!=after[name]]
    require(set(changed)<=set(allowed), 'CANDIDATE_HAS_UNEXPECTED_CHANGES')
    return changed


def capture_file(work, path, data, mode=None, owner=None):
    require(path.resolve()==path and (not path.exists() or path.is_file()), 'INSTALL_PATH_UNSAFE')
    record = {'path':str(path), 'after_sha256':s.sha(data), 'existed':path.exists()}
    if path.exists():
        old = s.read(path)
        info = path.stat()
        backup = work/'files-before'/path.relative_to('/')
        s.write(backup, old)
        record.update(before_sha256=s.sha(old), backup=str(backup),
                      mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid)
    record['after_mode'] = mode if mode is not None else record.get('mode',0o644)
    record['after_owner'] = list(owner if owner is not None else (record.get('uid',0),record.get('gid',0)))
    return record


def validate_restore(records):
    # Validate every destination first: never overwrite a concurrent user edit.
    for item in records:
        path = Path(item['path'])
        require(path.resolve()==path, 'ROLLBACK_PATH_UNSAFE')
        if path.exists():
            require(s.sha(s.read(path)) in (item.get('before_sha256'),item['after_sha256']),
                    'ROLLBACK_CONCURRENT_FILE_CHANGE')
        if item['existed']:
            require(s.sha(s.read(Path(item['backup'])))==item['before_sha256'], 'ROLLBACK_BACKUP_CHANGED')


def restore_files(records):
    validate_restore(records)
    for item in reversed(records):
        path = Path(item['path'])
        if item['existed']:
            atomic_file(path,s.read(Path(item['backup'])),item['mode'],item['uid'],item['gid'])
        elif path.exists():
            path.unlink()


def unit_state(unit):
    result = subprocess.run(['systemctl','show',unit,'--no-pager',
                '--property=LoadState,ActiveState,UnitFileState,FragmentPath,DropInPaths'],
                capture_output=True,timeout=15)
    info = dict(line.split('=',1) for line in result.stdout.decode().splitlines() if '=' in line)
    require(result.returncode==0 or info.get('LoadState')=='not-found','SYSTEMD_STATE_FAILED')
    return info


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


class GoogleOutputRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        u = urlsplit(newurl)
        require(u.scheme=='https' and u.hostname=='script.googleusercontent.com' and
                u.port in (None,443) and not u.username and not u.password,
                'GAS_REDIRECT_REJECTED')
        return super().redirect_request(req,fp,code,msg,headers,newurl)


def request(url, body=None, headers=None, method='GET', *, google=False, timeout=20, maximum=131072):
    opener = build_opener(ProxyHandler({}),GoogleOutputRedirect() if google else NoRedirect())
    req = Request(url,data=body,headers=headers or {},method=method)
    try:
        response = opener.open(req,timeout=timeout)
    except HTTPError as error:
        response = error
    with response:
        data = response.read(maximum+1)
        require(len(data)<=maximum,'HTTP_RESPONSE_TOO_LARGE')
        return response.status,data,response.headers


def gas_fields(sync_key, valid_number):
    ts = str(int(time.time()*1000))
    order, token, number = 'bos-release-health', 'no-files', 'release-health'
    secret = hashlib.sha256(sync_key.encode()).hexdigest().encode()
    def sign(message):
        return base64.urlsafe_b64encode(hmac.new(secret,message.encode(),hashlib.sha256).digest()).rstrip(b'=').decode()
    return {'action':'archiveReport','archive_ts':ts,'order_id':order,'upload_token':token,
            'order_no':number,'report_type':'work','archive_sign':sign('|'.join((ts,order,token))),
            'order_no_sign':sign('|'.join((ts,order,token,number))) if valid_number else 'invalid-release-probe'}


def verify_gas(sync_key):
    for valid,expected in ((False,'INVALID_ORDER_NUMBER_SIGNATURE'),(True,'ACT_REQUIRED')):
        try:
            status,raw,_ = request(GAS,urlencode(gas_fields(sync_key,valid)).encode(),
                                   {'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
                                   'POST',google=True,timeout=35)
        except RuntimeError:
            raise
        except Exception:
            raise RuntimeError('GAS_CONNECTION_FAILED') from None
        s.emit('GAS_HTTP_STATUS',status)
        try:
            value = json.loads(raw)
        except Exception:
            raise RuntimeError('GAS_RESPONSE_NOT_JSON') from None
        code = value.get('error')
        if code in ('INVALID_ARCHIVE_SIGNATURE','ARCHIVE_REQUEST_EXPIRED',
                    'SUPABASE_SYNC_KEY is not configured','INVALID_ORDER_NUMBER_SIGNATURE','ACT_REQUIRED','ARCHIVE_BUSY'):
            s.emit('GAS_CHECK',{'http':status,'expected':expected,'result':code})
        require(status==200 and value.get('ok') is False and code==expected,'GAS_VERSION_OR_SIGNING_CHECK_FAILED')


def loopback(edge):
    ports = edge['NetworkSettings']['Ports'].get('9000/tcp') or []
    require(len(ports)==1 and ports[0]['HostIp']=='127.0.0.1' and
            re.fullmatch(r'[0-9]{1,5}',ports[0]['HostPort']), 'EDGE_LOOPBACK_PORT_UNKNOWN')
    return 'http://127.0.0.1:'+ports[0]['HostPort']


def api(base, slug, body=None, method='POST', headers=None):
    return request(base+'/functions/v1/'+slug,None if body is None else json.dumps(body).encode(),
                   {'Content-Type':'application/json','Origin':PUBLIC,**(headers or {})},method)


def health(base):
    status,raw,_ = api(base,'order-lifecycle-api',{'action':'health'})
    data = json.loads(raw)
    require(status==200 and data.get('ok') is True and data.get('service')=='order-lifecycle-api','EDGE_HEALTH_FAILED')


def wait_health(base):
    for attempt in range(20):
        try:
            health(base)
            return
        except Exception:
            time.sleep(0.5)
    raise RuntimeError('EDGE_STARTUP_FAILED')


def public_build(digest):
    try:
        status,data,_ = request(PUBLIC+'/build-version.js?bos_release_check='+str(time.time_ns()),
                                headers={'Cache-Control':'no-cache'},maximum=2_000_000)
    except Exception:
        raise RuntimeError('PUBLIC_BUILD_UNAVAILABLE') from None
    require(status==200 and s.sha(data)==digest, 'PUBLIC_BUILD_DIFFERS')


def storage_route(raw, order, config):
    require(isinstance(raw,str) and len(raw)<=8192,'SAVED_ATTACHMENT_FORMAT')
    u = urlsplit(raw)
    allowed = {config['public'],config['internal'],*config['legacy'].split(',')}
    token = re.sub(r'[^a-zA-Z0-9._-]+','_',str(order['token'] or ''))[-120:]
    prefix = '/storage/v1/object/sign/business-os-vk-files/orders/'+str(order['id'])+'/'+token+'/'
    path = unquote(u.path,errors='strict')
    file = path[len(prefix):]
    require(token and u.scheme in ('http','https') and u.scheme+'://'+u.netloc in allowed and
            not u.username and not u.password and not u.fragment and parse_qs(u.query).get('token') and
            path.startswith(prefix) and file and file not in ('.','..') and not re.search(r'[\\/\x00-\x1f]',file),
            'SAVED_ATTACHMENT_PATH_DIFFERS')
    suffix = path[len('/storage/v1/object/sign/business-os-vk-files/'):]
    return '/storage/v1/object/authenticated/business-os-vk-files/'+'/'.join(quote(p,safe='-_.!~*\'()') for p in suffix.split('/'))


def check_saved_files(journal, env, config, work):
    raw = v.sql(journal['database_id'],journal['database'],
        "SELECT json_build_object('id',id,'token',report_upload_token,'act',report_act_url,'photos',report_photo_urls) "
        "FROM public.orders WHERE report_uploaded_at IS NOT NULL AND report_act_url IS NOT NULL "
        "AND report_upload_token IS NOT NULL ORDER BY report_uploaded_at DESC LIMIT 1;",work,'saved-report-sample')
    if not raw.strip():
        s.emit('REAL_REPORT_FILES_CHECKED',0)
        return
    order = json.loads(raw)
    photos = json.loads(order['photos']) if isinstance(order['photos'],str) else order['photos']
    require(isinstance(photos,list) and photos,'SAVED_REPORT_PHOTO_MISSING')
    for value in (order['act'],photos[0]):
        route = storage_route(value,order,config)
        opener = build_opener(ProxyHandler({}),NoRedirect())
        req = Request(journal['loopback']+route,headers={
            'Authorization':'Bearer '+env['SUPABASE_SERVICE_ROLE_KEY'],
            'apikey':env['SUPABASE_SERVICE_ROLE_KEY'],'Range':'bytes=0-15'})
        try:
            with opener.open(req,timeout=20) as response:
                require(response.status in (200,206) and response.read(16),'SAVED_FILE_UNREADABLE')
        except Exception:
            raise RuntimeError('SAVED_FILE_UNREADABLE') from None
    s.emit('REAL_REPORT_FILES_CHECKED',2)


def smoke(base, env, candidate):
    health(base)
    service = {'Authorization':'Bearer '+env['SUPABASE_SERVICE_ROLE_KEY'],
               'apikey':env['SUPABASE_SERVICE_ROLE_KEY']}
    for table in ('business_staff','orders'):
        status,raw,_ = request(base+'/rest/v1/'+table+'?select=id&limit=0',headers=service)
        require(status==200 and json.loads(raw)==[], 'INTERNAL_REST_CHECK_FAILED')
    for slug,body in (('order-lifecycle-api',{'action':'reviewReport'}),('report-api',{'action':'finalizeMasterReport'}),
                      ('report-file-upload',{}),('drive-archive-api',{'action':'worker'}),
                      ('hands-report-api',{'action':'worker'}),('push-api',{'action':'status'})):
        status,raw,_ = api(base,slug,body)
        require(status==401 and json.loads(raw).get('ok') is False,'AUTH_CHECK_FAILED_'+slug)
    status,_,headers = api(PUBLIC,'push-api',method='OPTIONS',headers={
        'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-bos-session'})
    require(status in (200,204) and headers.get('Access-Control-Allow-Origin') in ('*',PUBLIC),'PUBLIC_PUSH_CORS_FAILED')
    health(PUBLIC)
    status,raw,_ = api(base,'gas-bridge-health',method='GET')
    outer = json.loads(raw)
    inner = json.loads(outer.get('body','{}'))
    require(status==200 and outer.get('ok') is True and inner.get('error')=='ACT_REQUIRED','LIVE_GAS_BRIDGE_FAILED')
    public_build(candidate['build-version.js'])


def sql_write(db, database, sql, work, label):
    # Explicit transaction and timeouts: lock contention aborts, not partial DDL.
    statement = "BEGIN; SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='60s';\n"+sql+'\nCOMMIT;'
    return v.run(['docker','exec','-i',db,'psql','-X','-qAt','-U','postgres','-d',database,
                  '-v','ON_ERROR_STOP=1'],work,label,statement.encode(),timeout=90)


def fresh_backup(db, database, work):
    path = work/'pre-activation.dump'
    with path.open('xb') as out:
        os.fchmod(out.fileno(),0o600)
        result = subprocess.run(['docker','exec',db,'pg_dump','-U','postgres','-d',database,'-Fc'],
                                stdout=out,stderr=subprocess.PIPE,timeout=180)
    s.write(work/'logs/fresh-backup.log',result.stderr)
    require(result.returncode==0 and path.stat().st_size>5 and s.read(path,1_000_000_000)[:5]==b'PGDMP',
            'FRESH_BACKUP_FAILED')
    v.run(['docker','exec','-i',db,'pg_restore','--list'],work,'fresh-backup-list',path.read_bytes(),timeout=60)
    return {'path':str(path),'sha256':s.sha(path.read_bytes())}


def rollback(work, journal):
    validate_restore(journal['files'])
    save(work,journal,'rolling_back')
    logs = Path(tempfile.mkdtemp(prefix='rollback-',dir=work))
    # Wait for the sole worker before changing its files or restarting edge.
    for unit in reversed(UNITS):
        current = unit_state(unit)
        if current.get('LoadState')!='not-found':
            v.run(['systemctl','stop',unit],logs,'stop-'+unit,timeout=110)
        if unit.endswith('.timer') and current.get('UnitFileState')=='enabled':
            v.run(['systemctl','disable',unit],logs,'timer-disable')
    v.run(['docker','stop','--time=30',journal['edge_id']],logs,'edge-stop')
    restore_files(journal['files'])
    v.run(['systemctl','daemon-reload'],logs,'daemon-reload')
    if journal['timer_before'].get('UnitFileState')=='enabled':
        v.run(['systemctl','enable',UNITS[1]],logs,'timer-enable')
    v.run(['docker','start',journal['edge_id']],logs,'edge-start')
    wait_health(journal['loopback'])
    for folder in ('edge','web'):
        require(s.tree(Path(journal['live'])/folder)==journal['before'][folder], 'ROLLBACK_TREE_DIFFERS')
    save(work,journal,'rolled_back')
    s.emit('FILES_ROLLED_BACK',True)
    s.emit('DATABASE_RESTORED_FROM_OLD_BACKUP',False)
    s.emit('ARCHIVE_TIMER_ACTIVE',False)
    s.emit('ARCHIVE_TIMER_ENABLED',journal['timer_before'].get('UnitFileState')=='enabled')


def prepare():
    journals = list(s.PARENT.glob('report-acceptance-stage-*/locked-*/runtime-*/runtime-journal.json'))
    require(bool(journals),'SUCCESSFUL_RUNTIME_JOURNAL_MISSING')
    path = max(journals,key=lambda p:p.stat().st_mtime_ns)
    rec = json.loads(s.read(path))
    runtime, stage, live = path.parent,Path(rec['prepared_stage']),Path(rec['live'])
    require(runtime.parent==stage and live.parent==s.PARENT and live.resolve()==live and
            rec['status']=='runtime_verified_not_activated' and rec['app_revision']==s.APP,'RUNTIME_IDENTITY_CHANGED')
    expected_tests = {'isolated','auth','cors','approval','retry','storage','archive','empty_queue','gas_config'}
    require(set(rec['runtime_tests'])==expected_tests and all(x is True for x in rec['runtime_tests'].values()),
            'RUNTIME_TESTS_INCOMPLETE')
    verification = json.loads(s.read(Path(rec['verification'])))
    require(verification['status']=='database_verified_not_activated' and
            verification['journal_sha256']==s.sha(s.read(stage/'journal.json')),'DATABASE_VERIFICATION_CHANGED')
    for folder,source in (('edge',runtime/'candidate/edge'),('web',stage/'candidate/web')):
        require(s.tree(live/folder)==rec['before'][folder],'LIVE_RELEASE_CHANGED')
        require(s.tree(source)==rec['candidate_'+folder],'VERIFIED_CANDIDATE_CHANGED')
    payload = stage/'payload/after'
    for name,versions in s.ASSETS.items():
        require(s.sha(s.read(payload/name))==versions['after'],'PAYLOAD_CHANGED')
    ids = s.command(['docker','ps','-q']).decode().split()
    containers = json.loads(s.command(['docker','inspect',*ids]))
    edge = next((c for c in containers if c['Id']==rec['edge_id']),None)
    require(edge and edge['Image']==rec['image'],'EDGE_CHANGED')
    for folder,target in (('sources','/bos-src'),('bundles','/bos-bundles'),('main','/bos-main')):
        require(s.mount(edge,target)==live/'edge'/folder,'EDGE_MOUNT_CHANGED')
    webs = [c for c in containers if any(m.get('Destination')=='/srv' and m.get('Source')==str(live/'web') for m in c['Mounts'])]
    require(len(webs)==1 and s.mount(webs[0],'/srv')==live/'web','WEB_MOUNT_CHANGED')
    db,database = v.database_route(edge,containers,live)
    require(db['Image']==verification['database']['database_image'],'DATABASE_IMAGE_CHANGED')
    config = json.loads(s.read(runtime/'candidate/edge/main/bos-report-env.json'))
    require(config['gas']==GAS and config['public']==PUBLIC and config['internal']==r.INTERNAL and
            re.fullmatch(r'[A-Za-z0-9_-]{32,128}',config['workerKey']),'RUNTIME_CONFIG_CHANGED')
    env = v.environment(edge)
    for name in ('SUPABASE_SERVICE_ROLE_KEY','BOS_SYNC_KEY'):
        require(bool(env.get(name)),'REQUIRED_ENV_MISSING_'+name)
    user = s.command(['docker','exec',edge['Id'],'id','-u']).strip()
    group = s.command(['docker','exec',edge['Id'],'id','-g']).strip()
    require(user.isdigit() and group.isdigit(),'RUNTIME_USER_UNKNOWN')
    units = {unit:unit_state(unit) for unit in UNITS}
    for unit,info in units.items():
        require(info.get('LoadState') in ('loaded','not-found') and info.get('ActiveState')=='inactive' and
                not info.get('DropInPaths') and info.get('FragmentPath','') in ('','/etc/systemd/system/'+unit),
                'EXISTING_WORKER_NEEDS_REVIEW')
        require(info.get('UnitFileState','') in ('','disabled','enabled','static','not-found'), 'WORKER_ENABLE_STATE_UNKNOWN')
    for parent in (Path('/opt'),Path('/opt/business-os')):
        require(parent.is_dir() and bool(parent.stat().st_mode&stat.S_IXOTH),'WORKER_PARENT_NOT_TRAVERSABLE')
    if WORKER.parent.exists():
        require(bool(WORKER.parent.stat().st_mode&stat.S_IXOTH),'WORKER_DIRECTORY_NOT_TRAVERSABLE')
    base = loopback(edge)
    health(base)
    public_build(rec['before']['web']['build-version.js'])
    s.emit('CURRENT_RELEASE_VERIFIED',True)
    verify_gas(env['BOS_SYNC_KEY'])
    s.emit('GAS_VERSION_AND_SIGNING_VERIFIED',True)
    allowed = {'main/index.ts','main/bos-report-env.ts','main/bos-report-env.json'}
    for slug,entry in rec['entrypoints'].items():
        allowed.update(('bundles/'+slug+'.eszip','sources/'+entry,
                        posixpath.normpath('sources/'+str(Path(entry).parent/'../_shared/report-storage.ts'))))
    edge_names = changed_files(rec['before']['edge'],rec['candidate_edge'],allowed)
    web_names = changed_files(rec['before']['web'],rec['candidate_web'],rec['frontend']['changed_files'])
    # Publish application assets before the shell and version-discovery files.
    web_names.sort(key=lambda n:({'index.html':1,'sw.js':2,'build-version.js':3}.get(n,0),n))
    work = Path(tempfile.mkdtemp(prefix='activate-',dir=runtime))
    files, contents = [], []
    for folder,names,source in (('edge',edge_names,runtime/'candidate/edge'),('web',web_names,stage/'candidate/web')):
        for name in names:
            data = s.read(source/name)
            secret = folder=='edge' and name=='main/bos-report-env.json'
            files.append(capture_file(work,live/folder/name,data,0o600 if secret else None,
                                      (int(user),int(group)) if secret else None))
            contents.append(data)
    external = [(WORKER,s.read(payload/'deploy/report-acceptance/archive-worker.py'),0o755),
                *[(Path('/etc/systemd/system')/unit,s.read(payload/'deploy/report-acceptance'/unit),0o644) for unit in UNITS],
                (WORKER_ENV,('BOS_DRIVE_WORKER_URL='+base+'/functions/v1/drive-archive-api\nBOS_DRIVE_WORKER_KEY='+config['workerKey']+'\n').encode(),0o600)]
    for dest,data,mode in external:
        files.append(capture_file(work,dest,data,mode,(0,0)))
        contents.append(data)
    journal = {'runtime_journal':str(path),'runtime_journal_sha256':s.sha(s.read(path)),
               'live':str(live),'edge_id':edge['Id'],'database_id':db['Id'],'database':database,
               'loopback':base,'before':rec['before'],'after':{'edge':rec['candidate_edge'],'web':rec['candidate_web']},
               'build':rec['frontend']['build'],'files':files,'timer_before':units[UNITS[1]],
               'gas_deployment_version':4,'gas_signing_verified':True,'database_migration_applied':False}
    save(work,journal,'prepared')
    return work,journal,contents,rec,env,payload,config


def activate():
    work,journal,contents,rec,env,payload,config = prepare()
    s.emit('ACTIVATION_DIR',str(work))
    check_saved_files(journal,env,config,work)
    journal['fresh_backup'] = fresh_backup(journal['database_id'],journal['database'],work)
    save(work,journal,'backup_ready')
    s.emit('FRESH_DATABASE_BACKUP_READY',True)
    live = Path(journal['live'])
    for folder in ('edge','web'):
        require(s.tree(live/folder)==journal['before'][folder],'CONCURRENT_LIVE_CHANGE')
    sql_write(journal['database_id'],journal['database'],s.read(payload/MIGRATION).decode()+
              "\nNOTIFY pgrst, 'reload schema';",work,'production-migration')
    journal['database_migration_applied'] = True
    save(work,journal,'migration_applied')
    s.emit('DATABASE_MIGRATION_APPLIED',True)
    try:
        save(work,journal,'installing_files')
        v.run(['docker','stop','--time=30',journal['edge_id']],work,'edge-stop')
        for item,data in zip(journal['files'],contents):
            require(s.sha(data)==item['after_sha256'],'INSTALL_PAYLOAD_CHANGED')
            atomic_file(Path(item['path']),data,item['after_mode'],*item['after_owner'])
        for folder in ('edge','web'):
            require(s.tree(live/folder)==journal['after'][folder],'INSTALLED_TREE_DIFFERS')
        v.run(['docker','start',journal['edge_id']],work,'edge-start')
        wait_health(journal['loopback'])
        save(work,journal,'checking_release')
        s.emit('VERIFIED_FILES_INSTALLED',True)
        smoke(journal['loopback'],env,rec['candidate_web'])
        # Read-only schema checks. No synthetic orders or staff are written.
        check = v.sql(journal['database_id'],journal['database'],
            "SELECT (to_regprocedure('public.bos_drive_claim()') is not null) AND "
            "EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.orders'::regclass AND tgname='bos_drive_capture' AND tgenabled='O') AND "
            "NOT has_function_privilege('anon','public.bos_drive_claim()','execute') AND "
            "NOT has_function_privilege('authenticated','public.bos_drive_claim()','execute');",work,'schema-check')
        require(check.strip()==b't','LIVE_SCHEMA_CHECK_FAILED')
        s.emit('LIVE_HTTP_AND_SCHEMA_CHECKS_OK',True)
        v.run(['systemctl','daemon-reload'],work,'worker-daemon-reload')
        save(work,journal,'starting_worker')
        v.run(['systemctl','start',UNITS[0]],work,'worker-first-run',timeout=110)
        result = s.command(['systemctl','show',UNITS[0],'--property=Result,ExecMainStatus']).decode()
        require('Result=success' in result and 'ExecMainStatus=0' in result,'WORKER_FIRST_RUN_FAILED')
        v.run(['systemctl','enable','--now',UNITS[1]],work,'timer-enable')
        timer = unit_state(UNITS[1])
        require(timer.get('ActiveState')=='active' and timer.get('UnitFileState')=='enabled','TIMER_NOT_ACTIVE')
        save(work,journal,'complete')
    except (Exception,KeyboardInterrupt):
        try:
            rollback(work,journal)
        except Exception:
            s.emit('ROLLBACK_REQUIRES_ATTENTION',True)
            s.emit('ACTIVATION_DIR',str(work))
        raise
    s.emit('BUILD',journal['build'])
    s.emit('GAS_DEPLOYMENT_VERIFIED',True)
    s.emit('ARCHIVE_TIMER_ENABLED',True)
    s.emit('PRODUCTION_UPDATED',True)


def main():
    global s,v,r
    os.umask(0o077)
    sys.dont_write_bytecode = True
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rollback',action='store_true')
    args = parser.parse_args()
    require(os.geteuid()==0,'ROOT_REQUIRED')
    s,v,r = load_helpers()
    with (s.PARENT/'.report-acceptance-stage.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        previous = list(s.PARENT.glob('report-acceptance-stage-*/locked-*/runtime-*/activate-*/activation.json'))
        if previous:
            path = max(previous,key=lambda p:p.stat().st_mtime_ns)
            journal = json.loads(s.read(path))
            if args.rollback:
                require(journal['phase']!='rolled_back','ALREADY_ROLLED_BACK')
                rollback(path.parent,journal)
                return
            if journal['phase']=='complete':
                require(all(s.tree(Path(journal['live'])/f)==journal['after'][f] for f in ('edge','web')),'ACTIVE_RELEASE_CHANGED')
                require(all(s.sha(s.read(Path(item['path'])))==item['after_sha256'] for item in journal['files']),
                        'ACTIVE_WORKER_FILES_CHANGED')
                timer = unit_state(UNITS[1])
                require(timer.get('ActiveState')=='active' and timer.get('UnitFileState')=='enabled','TIMER_NOT_ACTIVE')
                s.emit('BUILD',journal['build'])
                s.emit('ALREADY_ACTIVATED',True)
                s.emit('ARCHIVE_TIMER_ENABLED',True)
                s.emit('PRODUCTION_UPDATED',True)
                return
            require(journal['phase'] in ('prepared','backup_ready','migration_applied','rolled_back'),
                    'INCOMPLETE_ACTIVATION_USE_ROLLBACK')
        else:
            require(not args.rollback,'ACTIVATION_JOURNAL_MISSING')
        activate()


if __name__=='__main__':
    try:
        main()
    except (Exception,KeyboardInterrupt) as error:
        label = str(error) if isinstance(error,RuntimeError) or (s is not None and isinstance(error,s.Stop)) else 'COMMAND_OR_LAYOUT_UNAVAILABLE'
        if not re.fullmatch(r'[A-Za-z0-9_-]+',label):
            label = 'COMMAND_OR_LAYOUT_UNAVAILABLE'
        print('ACTIVATION_STOPPED='+label,flush=True)
        raise SystemExit(1)
