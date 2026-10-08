#!/usr/bin/env python3
"""Final server-side RU release. Fresh capture, source write-pause, explicit activation boundary."""
import argparse
import base64
import csv
import getpass
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import traceback
import warnings
from urllib.parse import quote
from urllib.request import Request, build_opener, ProxyHandler

from rehearse_services import Runner, write_env, COUNTS_SQL
from rehearse_restore import adapt_roles, prepare_database, check_restored_versions, CANDIDATE_IMAGE
from service_trial_files import materialize_storage
from backup_storage import auth_headers, NoRedirect, download, local_name, validate_manifest
from vault_rekey_trial import PREPARE, COPY, CHECK_METADATA, REKEY, CHECK_VALUES
from verify_trial_data import parse_data, digest_rows, SETTINGS
from edge_trial_files import read_verified_secrets
from edge_trial import new_fixture, with_fixture
from release_files import MAIN, SOURCE, origin_host, validate_trial, rewrite_frontend, render_caddy, transform_attachment, copy_frontend_assets
from release_source import Source, SourceStateError, durable_json, durable_text, flags_sql, recover_before_activation, RUNTIMES

FOLDER=Path(__file__).resolve().parent
ROOT=Path('/opt/business-os')
ORIGIN='https://139.100.237.167'
DATABASE='bos_restore_check'
LOADER='bos_restore_loader'
CADDY='caddy:2.11.7'

def release_jwt(secret,role):
    if role not in ('anon','service_role'):raise ValueError('Invalid API role')
    encode=lambda value:base64.urlsafe_b64encode(value).rstrip(b'=')
    now=int(time.time())
    body=encode(b'{"alg":"HS256","typ":"JWT"}')+b'.'+encode(json.dumps(
        {'iss':'supabase','role':role,'iat':now,'exp':now+10*365*86400},separators=(',',':')).encode())
    return (body+b'.'+encode(hmac.digest(secret.encode(),body,'sha256'))).decode()

def database_args(name,image,stage,network):
    stage=Path(stage)
    return ['docker','create','--name',name,'--label','bos.release='+name.removesuffix('-db'),
        '--network',network,'--restart','unless-stopped',
        '--memory','2g','--cpus','2','--shm-size','256m','--log-opt','max-size=10m','--log-opt','max-file=3',
        '--env-file',str(stage/'db.env'),'--mount',f'type=bind,source={stage/"data"},target=/var/lib/postgresql/data',
        '--mount',f'type=volume,source={name}-config,target=/etc/postgresql-custom',
        '--mount',f'type=bind,source={stage/"postgres.conf"},target=/bos-postgresql.conf,readonly',
        '--mount',f'type=bind,source={stage/"backup"},target=/backup,readonly',
        image,'postgres','-c','config_file=/bos-postgresql.conf']

def postgres_config(active=False):
    return ("include '/etc/postgresql/postgresql.conf'\nlisten_addresses='*'\n"
        f"cron.launch_active_jobs={'on' if active else 'off'}\ncron.database_name='{DATABASE}'\n"
        f"pg_net.database_name='{DATABASE}'\ncron.use_background_workers=on\ncron.max_running_jobs=4\nmax_worker_processes=32\nlog_min_messages=fatal\n")

def service_environments(password,jwt,anon,service,origin,prefix=None):
    host=prefix+'-db' if prefix else '127.0.0.1'
    rest_host=prefix+'-rest' if prefix else '127.0.0.1'
    bind='0.0.0.0' if prefix else '127.0.0.1'
    pg=lambda role:f'postgres://{role}:{password}@{host}:5432/{DATABASE}'
    return {
      'rest':{'PGRST_DB_URI':pg('authenticator'),'PGRST_DB_SCHEMAS':'public','PGRST_DB_ANON_ROLE':'anon',
        'PGRST_JWT_SECRET':jwt,'PGRST_SERVER_HOST':bind,'PGRST_SERVER_PORT':'3000',
        'PGRST_DB_MAX_ROWS':'1000','PGRST_LOG_LEVEL':'error'},
      'auth':{'GOTRUE_API_HOST':bind,'GOTRUE_API_PORT':'9999','API_EXTERNAL_URL':origin+'/auth/v1',
        'GOTRUE_DB_DRIVER':'postgres','GOTRUE_DB_DATABASE_URL':pg('supabase_auth_admin'),'GOTRUE_SITE_URL':origin,
        'GOTRUE_DISABLE_SIGNUP':'true','GOTRUE_JWT_SECRET':jwt,'GOTRUE_JWT_ADMIN_ROLES':'service_role',
        'GOTRUE_JWT_AUD':'authenticated','GOTRUE_JWT_DEFAULT_GROUP_NAME':'authenticated','GOTRUE_JWT_EXP':'3600',
        'GOTRUE_EXTERNAL_EMAIL_ENABLED':'true','GOTRUE_EXTERNAL_PHONE_ENABLED':'false',
        'GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED':'false','GOTRUE_MAILER_AUTOCONFIRM':'false','GOTRUE_LOG_LEVEL':'error'},
      'storage':{'ANON_KEY':anon,'SERVICE_KEY':service,'AUTH_JWT_SECRET':jwt,'POSTGREST_URL':f'http://{rest_host}:3000',
        'DATABASE_URL':pg('supabase_storage_admin'),'DATABASE_MAX_CONNECTIONS':'8','STORAGE_BACKEND':'file',
        'FILE_STORAGE_BACKEND_PATH':'/var/lib/storage','GLOBAL_S3_BUCKET':'stub','TENANT_ID':'stub','REGION':'local',
        'FILE_SIZE_LIMIT':'52428800','STORAGE_PUBLIC_URL':origin+'/storage/v1','ENABLE_IMAGE_TRANSFORMATION':'false',
        'TUS_USE_FILE_VERSION_SEPARATOR':'false','STORAGE_FILE_ETAG_ALGORITHM':'md5','S3_PROTOCOL_ENABLED':'false','LOG_LEVEL':'error'}}

class ReleaseRunner(Runner):
    def command(self,args,input=None,timeout=60,required=True):
        result=subprocess.run(args,input=input,capture_output=True,timeout=timeout)
        error=result.stderr
        for value in self.redactions:
            if value:error=error.replace(value.encode(),b'<redacted>')
        try:
            with (self.stage/'commands.log').open('ab') as output:output.write(error)
        except OSError:pass  # Cleanup and source recovery must still execute on ENOSPC.
        if required and result.returncode:raise RuntimeError('Command failed')
        return result

    def create(self,name,args):
        if not name.startswith(self.prefix+'-') or self.inspect(name,optional=True) is not None:
            raise ValueError('Release container name collision')
        self.created.append(name)
        self.command(args,timeout=60)
        info=self.inspect(name)
        if info['Config'].get('Labels',{}).get('bos.release')!=self.prefix:
            raise ValueError('Release container ownership mismatch')
        return info['Id']

    def stop_owned(self,skip=()):
        ok=True
        for name in reversed(self.created):
            if name in skip:continue
            try:
                info=self.inspect(name,optional=True)
                if info is None:continue
                if info['Config'].get('Labels',{}).get('bos.release')!=self.prefix:ok=False;continue
                self.command(['docker','update','--restart=no',name],timeout=20)
                self.command(['docker','stop','--time','20',name],timeout=45)
                if self.inspect(name)['State']['Running']:ok=False
            except (Exception,KeyboardInterrupt):ok=False
        return ok

    def target_sql(self,query,user=LOADER,db=DATABASE,required=True,timeout=90):
        return self.command(['docker','exec','-i',self.prefix+'-db','psql','-X','-w','-qAt','-h','127.0.0.1',
          '-U',user,'-d',db,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=terse'],input=query.encode(),timeout=timeout,required=required)

def failure_recovery(r,source,activation,details):
    try:(r.stage/'failure.log').write_text(details)
    except (Exception,KeyboardInterrupt):pass
    try:r.private_service_logs()
    except (Exception,KeyboardInterrupt):pass
    target_stopped=r.stop_owned(skip=(r.prefix+'-source',))
    thawed=False
    if target_stopped and source:
        thawed=recover_before_activation(source.attempted,activation,source.thaw)
    if source:r.stop_owned()
    return thawed

def docker_base(r,name,network,env=None):
    args=['docker','create','--name',name,'--label','bos.release='+r.prefix,'--network',network,
          '--restart','unless-stopped','--memory','1g','--cpus','1','--log-opt','max-size=10m','--log-opt','max-file=3']
    if env:args+=['--env-file',str(env)]
    return args

def ready(r,callback,attempts=60):
    deadline=time.monotonic()+attempts
    while time.monotonic()<deadline:
        try:
            if callback():return
        except (Exception,KeyboardInterrupt) as e:
            if isinstance(e,KeyboardInterrupt):raise
        time.sleep(1)
    raise RuntimeError('Readiness timeout')

def localhost(path,service=None,body=None,method=None):
    headers={}
    if service:headers.update(authorization='Bearer '+service,apikey=service)
    data=None if body is None else json.dumps(body).encode()
    if data is not None:headers['content-type']='application/json'
    return build_opener(ProxyHandler({}),NoRedirect()).open(Request('http://127.0.0.1:19000'+path,
        data=data,headers=headers,method=method),timeout=60)

def build_frontend(r,repo,node_image):
    if r.command(['git','-C',str(repo),'rev-parse','HEAD']).stdout.decode().strip()!=MAIN:
        raise ValueError('Server app is not the approved main commit')
    out=r.stage/'web-build';out.mkdir(mode=0o700)
    archive=r.command(['git','-C',str(repo),'archive',MAIN],timeout=60).stdout
    with tarfile.open(fileobj=io.BytesIO(archive)) as tf:
        for member in tf.getmembers():
            if member.issym() or member.islnk() or not (member.isdir() or member.isfile()):raise ValueError('Unexpected source archive entry')
        tf.extractall(out,filter='data')
    for path in out.iterdir():
        if path.is_file() and path.suffix in ('.js','.html','.webmanifest'):
            path.write_text(rewrite_frontend(path.read_text(),ORIGIN))
    (out/'network-direct-v86.js').write_bytes((FOLDER/'release_network.js').read_bytes())
    # Config follows the transport in the existing startup manifest; its legacy wrapper is disabled by the marker.
    name=r.prefix+'-web-build'
    args=docker_base(r,name,'none')
    args[args.index('--restart')+1]='no'
    args+=['--user','0','--entrypoint','node','--mount',f'type=bind,source={out},target=/work',
           '--workdir','/work',node_image,'scripts/build-version.cjs']
    r.create(name,args);r.command(['docker','start','--attach',name],timeout=120)
    if r.inspect(name)['State']['ExitCode']!=0:raise RuntimeError('Frontend build failed')
    web=r.stage/'web';web.mkdir(mode=0o700)
    copy_frontend_assets(out,web)
    return hashlib.sha256((web/'build-version.js').read_bytes()).hexdigest()

def copy_edge(r,trial,routes,values,jwt,anon,service):
    root=r.stage/'edge';root.mkdir(mode=0o700)
    for sub in ('sources','bundles'):
        src=trial/'edge'/sub
        if any(p.is_symlink() for p in src.rglob('*')):raise ValueError('Symlink in Edge tree')
        shutil.copytree(src,root/sub)
    (root/'main').mkdir(mode=0o700)
    shutil.copyfile(FOLDER/'release_router.mjs',root/'main/index.ts')
    shutil.copyfile(FOLDER/'edge_router.mjs',root/'main/edge_router.mjs')
    (root/'main/routes.json').write_text(json.dumps(routes))
    write_env(root/'runtime.env',{**values,'JWT_SECRET':jwt,'SUPABASE_URL':ORIGIN,
        'SUPABASE_ANON_KEY':anon,'SUPABASE_SERVICE_ROLE_KEY':service,
        'BOS_REST_ORIGIN':'http://'+r.prefix+'-rest:3000','BOS_AUTH_ORIGIN':'http://'+r.prefix+'-auth:9999',
        'BOS_STORAGE_ORIGIN':'http://'+r.prefix+'-storage:5000'})
    for slug,route in routes.items():
        if hashlib.sha256((root/'bundles'/(slug+'.eszip')).read_bytes()).hexdigest()!=route['bundle_sha256']:
            raise ValueError('Copied bundle hash mismatch')

def initialize_target(r,image,password):
    (r.stage/'data').mkdir(mode=0o700)
    (r.stage/'postgres.conf').write_text(postgres_config(False));os.chmod(r.stage/'postgres.conf',0o644)
    (r.stage/'backup').mkdir(mode=0o700)
    write_env(r.stage/'db.env',{'POSTGRES_PASSWORD':password,'PGPASSWORD':password,'POSTGRES_DB':'postgres',
      'PGDATABASE':'postgres','PGPORT':'5432','POSTGRES_PORT':'5432','POSTGRES_HOST':'/var/run/postgresql','JWT_EXP':'3600'})
    internal=r.prefix+'-internal'
    r.command(['docker','network','create','--internal','--label','bos.release='+r.prefix,internal])
    name=r.prefix+'-db';r.create(name,database_args(name,image,r.stage,internal));r.start(name)
    ready(r,lambda:r.target_sql('SELECT 1;',user='postgres',db='postgres',required=False,timeout=10).stdout.strip()==b'1',90)
    def sql(query,user='postgres',db='postgres'):
        raw=r.target_sql(query,user=user,db=db)
        return subprocess.CompletedProcess(raw.args,raw.returncode,raw.stdout.decode(),raw.stderr.decode())
    prepare_database(sql)
    # Real private-network/DNS/password check before any source write pause.
    client=r.prefix+'-db-connect'
    args=docker_base(r,client,internal,r.stage/'db.env');args[args.index('--restart')+1]='no'
    args+=['--entrypoint','psql',image,'-X','-w','-h',name,'-U',LOADER,'-d',DATABASE,'-Atc','SELECT 1;']
    r.create(client,args)
    result=r.command(['docker','start','--attach',client],timeout=45)
    if r.inspect(client)['State']['ExitCode']!=0 or result.stdout.strip()!=b'1':raise RuntimeError('Private DB connection failed')

def restore_target(r,image,backup,password):
    name=r.prefix+'-db'
    role_sql=adapt_roles((backup/'roles.sql').read_text(),LOADER)
    r.target_sql('BEGIN;\n'+role_sql+'\nCOMMIT;')
    r.command(['docker','exec','-e','PGOPTIONS=-c session_replication_role=replica',name,'pg_restore','-h','127.0.0.1',
        '-U',LOADER,'-d',DATABASE,'-w','--exit-on-error','--single-transaction','/backup/source.dump'],timeout=600)
    versions=json.loads(r.target_sql("SELECT jsonb_build_object('server_version_num',current_setting('server_version_num')::int,"
        "'cron_enabled',current_setting('cron.launch_active_jobs'),'extensions',(SELECT jsonb_object_agg(extname,extversion) FROM pg_extension));").stdout)
    check_restored_versions(versions,CANDIDATE_IMAGE)
    # Same diagnosed grants as the successful restore. No owner/catalog surgery.
    r.target_sql('BEGIN; SET LOCAL ROLE postgres; GRANT CREATE ON DATABASE bos_restore_check TO supabase_etl_admin,supabase_storage_admin; '
      'GRANT CONNECT,CREATE,TEMPORARY ON DATABASE bos_restore_check TO dashboard_user; RESET ROLE; SET LOCAL ROLE supabase_admin; '
      'GRANT USAGE ON SCHEMA graphql,graphql_public TO anon,authenticated,service_role; '
      'GRANT USAGE ON SCHEMA graphql,graphql_public TO postgres WITH GRANT OPTION; RESET ROLE; COMMIT;')
    vault=(backup/'vault.csv').read_bytes()
    r.command(['docker','exec','-i',name,'psql','-X','-w','-qAt','-h','127.0.0.1','-U',LOADER,'-d',DATABASE,
      '-v','ON_ERROR_STOP=1','-v','VERBOSITY=terse','-c',PREPARE,'-c',COPY,'-c',CHECK_METADATA+REKEY+CHECK_VALUES+'COMMIT;'],input=vault)
    # Compare the newly captured data, not historical rehearsal counts.
    archive=r.command(['docker','exec',name,'pg_restore','--data-only','--file=-','/backup/source.dump'],timeout=300).stdout
    tables,sequences=parse_data(archive)
    toc=r.command(['docker','exec',name,'pg_restore','--list','/backup/source.dump']).stdout.decode()
    (backup/'contents.txt').write_text(toc)
    if len(tables)!=toc.count(' TABLE DATA ') or len(sequences)!=toc.count(' SEQUENCE SET '):
        raise ValueError('Unsupported archive data entry')
    for table in tables:
        data=r.target_sql(SETTINGS+f"COPY (SELECT {table['columns']} FROM ONLY {table['table']}) TO STDOUT;\nROLLBACK;").stdout
        lines=list(io.BytesIO(data))
        if len(lines)!=table['rows'] or digest_rows(lines,table['skip'])!=table['sha256']:
            raise ValueError('Fresh data differs after restore')
    for name,value,called in sequences:
        row=r.target_sql(f'SELECT last_value,is_called FROM {name};').stdout.strip().decode()
        if row!=str(value)+'|'+('t' if called else 'f'):raise ValueError('Fresh sequence differs')
    (backup/'SHA256SUMS').write_text(''.join(hashlib.sha256((backup/n).read_bytes()).hexdigest()+'  '+n+'\n'
        for n in ('source.dump','roles.sql','contents.txt','vault.csv','storage.json')))
    return {'tables':len(tables),'sequences':len(sequences)}

def sync_files(r,rows,key):
    validate_manifest(rows)
    raw=r.stage/'storage-source';raw.mkdir(mode=0o700)
    (raw/'objects').mkdir(mode=0o700)
    opener=build_opener(ProxyHandler({}),NoRedirect());headers=auth_headers(key);verified=[]
    for i,row in enumerate(rows,1):
        result=download(opener,headers,row,raw/'objects'/local_name(row))
        verified.append({**row,'source_file':str(raw/result['file']),'sha256':result['sha256'],
          'mimetype':row['metadata'].get('mimetype') or 'application/octet-stream',
          'cache_control':row['metadata'].get('cacheControl') or 'no-cache'})
        if i%50==0 or i==len(rows):print(f'Актуальные файлы: {i}/{len(rows)}',flush=True)
    snapshot={'objects':verified,'bytes':sum(x['metadata']['size'] for x in rows)}
    materialize_storage(snapshot,r.stage/'storage')
    durable_json(raw/'manifest.json',snapshot)
    return snapshot

def start_edge_gateway(r,images):
    # Docker omits host port mappings for a container attached only to internal networks.
    # The gateway needs a normal bridge; SQL stays on its separate internal network.
    r.command(['docker','network','create','--label','bos.release='+r.prefix,r.prefix+'-outbound'])
    name=r.prefix+'-edge';args=docker_base(r,name,r.prefix+'-outbound',r.stage/'edge/runtime.env')
    args+=['--publish','127.0.0.1:19000:9000','--read-only','--user','0','--tmpfs','/tmp:rw,nosuid,size=512m','--env','DENO_DIR=/tmp/deno','--entrypoint','/usr/local/bin/edge-runtime']
    for sub,dest in [('sources','/bos-src'),('bundles','/bos-bundles'),('main','/bos-main')]:
        args+=['--mount',f'type=bind,source={r.stage/"edge"/sub},target={dest},readonly']
    r.create(name,args+[images['edge'],'start','--main-service','/bos-main','--ip','0.0.0.0','--port','9000'])
    r.command(['docker','network','connect',r.prefix+'-internal',name])
    r.start(name)
    ports=r.inspect(name).get('NetworkSettings',{}).get('Ports',{}).get('9000/tcp')
    if ports!=[{'HostIp':'127.0.0.1','HostPort':'19000'}]:
        raise RuntimeError('Edge loopback port was not published correctly')
    # This route starts no user worker and makes no upstream/API/database request.
    ready(r,lambda:localhost('/__bos_ready').read()==b'{"ready":true}')

def start_services(r,images,values,password,jwt,anon,service):
    r.target_sql("BEGIN; SET LOCAL log_statement='none'; SET LOCAL log_min_error_statement='panic'; SET LOCAL pgaudit.log='none';\n"+
        ''.join(f"ALTER ROLE {role} PASSWORD '{password}';\n" for role in ('authenticator','supabase_auth_admin','supabase_storage_admin'))+'COMMIT;')
    for role,env in service_environments(password,jwt,anon,service,ORIGIN,r.prefix).items():
        write_env(r.stage/(role+'.env'),env)
        name=r.prefix+'-'+role;args=docker_base(r,name,r.prefix+'-internal',r.stage/(role+'.env'))
        if role=='storage':args+=['--mount',f'type=bind,source={r.stage/"storage"},target=/var/lib/storage',
            '--mount',f'type=bind,source={r.stage/"probes"},target=/bos-probes,readonly']
        r.create(name,args+[images[role]]);r.start(name)
    ready(r,lambda:localhost('/__bos_ready').read()==b'{"ready":true}')
    ready(r,lambda:json.load(localhost('/auth/v1/admin/users',service)).get('users') is not None)
    ready(r,lambda:isinstance(json.load(localhost('/storage/v1/bucket',service)),list))

def resign_links(r,rows,service):
    allowed={row['bucket_id']+'/'+row['name'] for row in rows};cache={}
    def sign(path):
        if path not in allowed:raise ValueError('Attachment not present in final file snapshot')
        if path not in cache:
            result=json.load(localhost('/storage/v1/object/sign/'+quote(path,safe='/'),service,{'expiresIn':315360000}))
            signed=result.get('signedURL') or result.get('signedUrl')
            if not isinstance(signed,str) or not signed.startswith('/object/sign/') or '?token=' not in signed:
                raise ValueError('Unexpected signed Storage response')
            cache[path]=ORIGIN+'/storage/v1'+signed
        return cache[path]
    columns=json.loads(r.target_sql("SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'column',a.attname,'type',t.typname)),'[]') "
        "FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid "
        "JOIN pg_type t ON t.oid=a.atttypid WHERE c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped "
        "AND n.nspname IN ('public','bos','agent','bos_hands_private','bos_push_private','bos_avito_private','bos_control_private') "
        "AND t.typname IN ('text','varchar','json','jsonb');").stdout)
    changed=0
    ident=lambda s:'"'+s.replace('"','""')+'"'
    lit=lambda s:"'"+s.replace("'","''")+"'"
    for column in columns:
        table=ident(column['schema'])+'.'+ident(column['table']);col=ident(column['column'])
        found=json.loads(r.target_sql(f"SELECT coalesce(jsonb_agg(jsonb_build_object('ctid',ctid::text,'value',{col}::text)),'[]') FROM {table} "
            f"WHERE {col}::text LIKE '%obsropbslfwtanyspjbi.supabase.co/storage/%';").stdout)
        for row in found:
            if not re.fullmatch(r'\(\d+,\d+\)',row['ctid']):raise ValueError('Invalid target row identity')
            new=transform_attachment(row['value'],sign)
            sql=f"BEGIN; SET LOCAL session_replication_role=replica; UPDATE {table} SET {col}={lit(new)}::{column['type']} "
            sql+=f"WHERE ctid={lit(row['ctid'])}::tid AND {col}::text={lit(row['value'])}; COMMIT;"
            r.target_sql(sql);changed+=1
    for schema in ('bos_push_private','bos_hands_private','bos_avito_private'):
        r.target_sql(f"UPDATE {schema}.runtime SET worker_url=replace(worker_url,'{SOURCE}','{ORIGIN}') "
            f"WHERE worker_url LIKE '{SOURCE}/functions/v1/%';")
    r.target_sql("UPDATE cron.job SET database='bos_restore_check' WHERE database='postgres';")
    return {'attachment_values':changed,'signed_objects':len(cache)}

def app_probe(r,values,counts):
    fixture=new_fixture();r.redactions.append(fixture['password'])
    probe=(FOLDER/'edge_probe.mjs').read_text().replace('http://127.0.0.1:9000','http://'+r.prefix+'-edge:9000').replace('r.body.orders?.length===114','r.body.orders?.length===c.expected_orders').replace('bos_bootstrap_orders:114','bos_bootstrap_orders:c.expected_orders')
    (r.stage/'probes/login.mjs').write_text(probe)
    routes=json.loads((r.stage/'edge/main/routes.json').read_text())
    (r.stage/'probes/login.json').write_text(json.dumps({'fixture':fixture,'vk_secret':values['VK_APP_SECRET'],
        'expected_orders':counts['orders'],'protected_slugs':[s for s,v in routes.items() if v['verify_jwt']]}))
    def run():
        result=r.command(['docker','exec',r.prefix+'-storage','node','/bos-probes/login.mjs','/bos-probes/login.json'],timeout=240)
        data=json.loads(result.stdout)
        if data.get('bos_password_login') is not True or data.get('bos_bootstrap_orders')!=counts['orders']:
            raise RuntimeError('Final login probe failed')
        return data
    # Existing fixture helper uses Runner.sql, whose namespace/database are identical here.
    return with_fixture(r,r.prefix+'-db',fixture,run)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--app',type=Path,default=ROOT/'app')
    p.add_argument('--secrets',type=Path,default=ROOT/'deploy/runtime-secrets-4rovqvfz')
    p.add_argument('--cutover',action='store_true',required=True,help='Authorized source write pause and target activation')
    args=p.parse_args()
    if os.geteuid()!=0:raise ValueError('Run on server as root')
    os.umask(0o077);origin_host(ORIGIN)
    lock=os.open(ROOT/'deploy/final-release.lock',os.O_CREAT|os.O_WRONLY,0o600)
    import fcntl
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    candidates=[]
    for path in (ROOT/'deploy').glob('service-trial-*'):
        if (path/'report.json').is_file():
            try:report,routes=validate_trial(path);candidates.append((path.stat().st_mtime_ns,path,report,routes))
            except (ValueError,KeyError,OSError):continue
    if not candidates:raise ValueError('No successful core+Edge trial found')
    _,trial,proof,routes=max(candidates,key=lambda x:x[0])
    for name in ('db','rest','auth','storage','edge'):
        info=json.loads(subprocess.run(['docker','inspect','bos-'+trial.name+'-'+name],capture_output=True,check=True).stdout)[0]
        image=proof['edge']['image_id'] if name=='edge' else proof['image_ids'][name]
        if (info['State']['Running'] or info['Image']!=image or
            info['Config'].get('Labels',{}).get('bos.service-trial')!='bos-'+trial.name):
            raise ValueError('Successful trial identity changed')
    stage=Path(tempfile.mkdtemp(prefix='release-',dir=ROOT/'deploy'));prefix='bos-'+stage.name
    r=ReleaseRunner(stage,prefix);source=None;activation=False;success=False;phase='preflight'
    print('Каталог запуска:',stage,flush=True)
    def interrupted(signum,frame):raise KeyboardInterrupt
    signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGHUP,interrupted)
    try:
        for port in (80,443,12019,19000):
            with socket.socket() as sock:sock.bind(('0.0.0.0' if port in (80,443) else '127.0.0.1',port))
        if shutil.disk_usage(stage).free<8*1024**3:raise ValueError('Need at least 8 GiB free')
        values=read_verified_secrets(args.secrets);r.redactions.extend(values.values())
        images={**proof['image_ids'],'edge':proof['edge']['image_id']}
        for image in images.values():
            info=json.loads(r.command(['docker','image','inspect',image]).stdout)[0]
            if info['Id']!=image or info['Os']!='linux' or info['Architecture']!='amd64':raise ValueError('Image identity changed')
        print('Подготовка приложения и HTTPS до остановки записи...',flush=True)
        web_hash=build_frontend(r,args.app,images['storage'])
        r.command(['docker','pull',CADDY],timeout=600)
        ci=json.loads(r.command(['docker','image','inspect',CADDY]).stdout)[0]
        if ci['Os']!='linux' or ci['Architecture']!='amd64' or not re.fullmatch('sha256:[a-f0-9]{64}',ci['Id']):raise ValueError('Caddy image invalid')
        images['caddy']=ci['Id'];durable_json(stage/'images.json',images)
        password=secrets.token_hex(32);jwt=secrets.token_hex(48);anon=release_jwt(jwt,'anon');service=release_jwt(jwt,'service_role')
        r.redactions.extend([password,jwt,anon,service])
        copy_edge(r,trial,routes,values,jwt,anon,service)
        (stage/'probes').mkdir(mode=0o700)
        for d in ('caddy','caddy-config'):(stage/d).mkdir(mode=0o700)
        certificates=ROOT/'data/https-certificates'
        certificates.mkdir(mode=0o700,exist_ok=True)
        if certificates.is_symlink() or certificates.stat().st_uid!=0 or certificates.stat().st_mode&0o077:
            raise ValueError('HTTPS certificate directory must be root private')
        (stage/'caddy/Caddyfile').write_text(render_caddy(ORIGIN,service,False))
        (stage/'caddy/active.Caddyfile').write_text(render_caddy(ORIGIN,service,True))
        caddy=prefix+'-https';ca=docker_base(r,caddy,'host')+['--user','0']
        for src,dest,ro in [(stage/'caddy','/etc/caddy',True),(stage/'web','/srv',True),(certificates,'/data',False),(stage/'caddy-config','/config',False)]:
            ca+=['--mount',f'type=bind,source={src},target={dest}'+(',readonly' if ro else '')]
        r.create(caddy,ca+[images['caddy']]);r.start(caddy)
        phase='https'
        def https_ready():
            result=r.command(['curl','--silent','--show-error','--fail','--noproxy','*','--max-time','8',ORIGIN+'/_bos/ready'],timeout=12,required=False)
            return result.returncode==0 and result.stdout==b'BOS_HTTPS_READY'
        ready(r,https_ready,120)
        phase='target_database_preparation'
        initialize_target(r,images['db'],password)
        phase='edge_gateway_preparation'
        start_edge_gateway(r,images)
        print('HTTPS и Edge-шлюз готовы. Введите два исходных секрета; они останутся на сервере.',flush=True)
        warnings.simplefilter('error',getpass.GetPassWarning)
        source_password=getpass.getpass('Пароль исходной БД Supabase: ')
        storage_key=getpass.getpass('Серверный API-ключ исходного Supabase: ').strip()
        auth_headers(storage_key);r.redactions.extend([source_password,storage_key])
        write_env(stage/'source.env',{'PGHOST':'aws-0-eu-west-2.pooler.supabase.com','PGPORT':'5432',
          'PGUSER':'postgres.obsropbslfwtanyspjbi','PGDATABASE':'postgres','PGPASSWORD':source_password,
          'PGSSLMODE':'require','PGCONNECT_TIMEOUT':'15','PGAPPNAME':'bos-final-migration'})
        client=prefix+'-source';cmd=docker_base(r,client,'host',stage/'source.env');cmd[cmd.index('--restart')+1]='no'
        r.create(client,cmd+['--entrypoint','/bin/sh',images['db'],'-c','while :; do sleep 3600; done']);r.start(client)
        source=Source(r,client,stage);source.preflight()
        # Validate Storage credentials with GET before pausing writes.
        with build_opener(ProxyHandler({}),NoRedirect()).open(Request(SOURCE+'/storage/v1/bucket',headers=auth_headers(storage_key)),timeout=30) as response:
            if response.status!=200:raise RuntimeError('Source Storage credentials rejected')
        thaw_script=f'''#!/bin/sh
set -eu
cd '{stage}'
test ! -f activation-attempted.json || {{ echo 'После переключения автоматический откат запрещён: новые данные могут быть в РФ.'; exit 1; }}
docker run --rm -i --network host --env-file source.env --entrypoint psql {images['db']} -X -w -v ON_ERROR_STOP=1 < source-thaw.sql
'''
        durable_text(stage/'resume-source.sh',thaw_script,mode=0o700)
        control=f'''#!/bin/sh
set -eu
case "${{1:-status}}" in
 status) docker ps -a --filter label=bos.release={prefix} --format 'table {{{{.Names}}}}\\t{{{{.Status}}}}' ;;
 stop) docker stop {prefix}-https {prefix}-edge {prefix}-storage {prefix}-auth {prefix}-rest {prefix}-db ;;
 start)
   docker start {prefix}-db
   n=0
   until docker exec {prefix}-db pg_isready -h 127.0.0.1 -U {LOADER} -d {DATABASE} >/dev/null 2>&1; do
     n=$((n+1)); test "$n" -lt 60 || exit 1; sleep 1
   done
   docker start {prefix}-rest {prefix}-auth {prefix}-storage {prefix}-edge {prefix}-https ;;
 *) echo 'Use: status | start | stop'; exit 2 ;;
esac
'''
        durable_text(stage/'control.sh',control,mode=0o700)
        phase='source_freeze';print('Остановка записи на исходной БД. Начинается финальный перенос.',flush=True)
        source.freeze()
        phase='fresh_capture';rows=source.capture(stage/'backup')
        print('Файлов в актуальном снимке:',len(rows),flush=True)
        phase='fresh_restore';data_proof=restore_target(r,images['db'],stage/'backup',password)
        phase='fresh_files';snapshot=sync_files(r,rows,storage_key);del storage_key
        source.assert_frozen()
        phase='services';start_services(r,images,values,password,jwt,anon,service)
        counts=json.loads(r.target_sql(COUNTS_SQL).stdout)
        if counts['storage_objects']!=len(rows) or counts['cron_enabled']!='off':raise ValueError('Final target counts mismatch')
        phase='attachment_links';links=resign_links(r,rows,service)
        if r.target_sql('SELECT count(*) FROM net.http_request_queue;').stdout.strip()!=b'0':raise ValueError('Unexpected pending target HTTP requests')
        # Give SQL/pg_net egress only after its source-derived worker URLs are local.
        # Gateway egress was prepared before freeze; its public API is still gated by Caddy.
        r.command(['docker','network','connect',prefix+'-outbound',prefix+'-db'])
        phase='final_login';login=app_probe(r,values,counts)
        source.assert_frozen()
        phase='activate'
        # Once reload might expose writes, source must never thaw automatically.
        durable_json(stage/'activation-attempted.json',{'origin':ORIGIN,'source_frozen':True});activation=True
        # Persist active config before reload: a restart cannot fall back to maintenance.
        shutil.copyfile(stage/'caddy/active.Caddyfile',stage/'caddy/next.Caddyfile')
        os.replace(stage/'caddy/next.Caddyfile',stage/'caddy/Caddyfile')
        r.command(['docker','exec',caddy,'caddy','reload','--config','/etc/caddy/Caddyfile',
                   '--adapter','caddyfile','--address','127.0.0.1:12019'],timeout=30)
        phase='background_jobs'
        r.target_sql('BEGIN;\n'+flags_sql(source.state)+'\nCOMMIT;')
        (stage/'postgres.conf').write_text(postgres_config(True))
        r.target_sql('SELECT pg_reload_conf();')
        ready(r,lambda:r.target_sql('SHOW cron.launch_active_jobs;').stdout.strip()==b'on',15)
        source.assert_frozen()
        report={'origin':ORIGIN,'source_readonly':True,'counts':counts,'data':data_proof,'files':len(rows),'bytes':snapshot['bytes'],
          'attachments':links,'login':login,'build_sha256':web_hash,'images':images,'background_jobs':'enabled_on_target',
          'old_frontend_switch':'pending_after_server_result'}
        durable_json(stage/'report.json',report)
        r.command(['docker','stop',client],timeout=30)
        success=True
        print('BOS_RU_APP_ONLINE',flush=True);print('Адрес:',ORIGIN,flush=True)
        print('Перенесено:',json.dumps({'orders':counts['orders'],'staff':counts['staff'],'files':len(rows),'bytes':snapshot['bytes']},ensure_ascii=False),flush=True)
        print('Старая БД оставлена без записи. Фоновые задания перенесены. Старый адрес приложения ещё нужно переключить.',flush=True)
        return 0
    except (Exception,KeyboardInterrupt) as error:
        details=traceback.format_exc()
        thawed=failure_recovery(r,source,activation,details)
        print('BOS_RELEASE_FAILED phase='+phase+' category='+type(error).__name__,flush=True)
        if isinstance(error,SourceStateError):print('BOS_SOURCE_STATE '+str(error),flush=True)
        if not source or not source.attempted:print('Этот запуск не изменял исходную БД.',flush=True)
        elif thawed:print('Запись в исходной БД восстановлена.',flush=True)
        else:
            print('Исходная БД автоматически не открыта. Файл восстановления:',stage/'resume-source.sh',flush=True)
        print('Закрытый журнал:',stage/'commands.log','— целиком в чат не отправлять.',flush=True)
        return 1
    finally:
        os.close(lock)

if __name__=='__main__':
    try:sys.exit(main())
    except (Exception,KeyboardInterrupt):print('BOS_RELEASE_PREFLIGHT_FAILED',flush=True);sys.exit(1)
