"""Disposable RU PostgreSQL + PostgREST + edge, all sharing loopback only.
No production data, credentials, ports, network or volume are mounted in the test.
"""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sys
import time
import urllib.parse
import zipfile
import backend as b
import frontend as f
import database as db


def jwt(role,secret):
    enc=lambda x:base64.urlsafe_b64encode(json.dumps(x,separators=(',',':')).encode()).decode().rstrip('=')
    raw=enc({'alg':'HS256','typ':'JWT'})+'.'+enc({'role':role,'exp':int(time.time())+7200})
    return raw+'.'+base64.urlsafe_b64encode(hmac.new(secret.encode(),raw.encode(),hashlib.sha256).digest()).decode().rstrip('=')


def envfile(name,values):
    path=b.STAGE/name
    f.require(all('\n' not in str(v) for v in values.values()),'Invalid test environment value')
    path.write_text(''.join(k+'='+str(v)+'\n' for k,v in values.items()));os.chmod(path,0o600)
    return str(path)


def invoke(args,label,**kwargs):return b.private_command(args,label,**kwargs).decode().strip()


def test_api(pid,secret,phase):
    source=Path(__file__).with_name('probe_requests.py').read_text() if Path(__file__).with_name('probe_requests.py').is_file() else None
    if source is None:
        with zipfile.ZipFile(Path(__file__).parent) as z:source=z.read('probe_requests.py').decode()
    result=invoke(['nsenter','-t',str(pid),'-n',sys.executable,'-c',source],phase+'-signed-api',timeout=50,input_data=json.dumps({'secret':secret,'phase':phase}).encode())
    report=json.loads(result)
    f.require(report.get('ok') is True,'Isolated signed API checks failed')
    f.emit('ISOLATED_API_'+phase.upper()+'=OK; checks='+str(report['checks']))
    return report


def ready(callback,tries=12):
    for n in range(tries):
        try:return callback()
        except (f.Stop,ValueError):
            if n==tries-1:raise
            time.sleep(1)


def pg_environment(password):
    # Match the image's bootstrap contract: migrate.sh explicitly connects as
    # supabase_admin and initializes roles/extensions in the postgres database.
    return {'POSTGRES_USER':'supabase_admin','POSTGRES_PASSWORD':password,
            'POSTGRES_DB':'postgres','PGDATA':'/var/lib/postgresql/data'}


def pg_execute(cid,name,statement):
    # The entrypoint's temporary init server accepts Unix sockets only. TCP
    # prevents a successful query from racing its remaining migrations/restart.
    return invoke(['docker','exec','-i','-e','PGHOST=127.0.0.1',cid,'sh','-c',
                   db.SHELL,'help-preview',name],'test-db-query',timeout=25,input_data=statement.encode())


def pg_sql(cid,statement,write=False,name='help_preview'):
    wrapper=('BEGIN;' if write else 'BEGIN READ ONLY;')+" SET LOCAL statement_timeout='15s'; "+statement+(' COMMIT;' if write else ' ROLLBACK;')
    return pg_execute(cid,name,wrapper)


def prepare_pg(cid):
    ready(lambda:json.loads(pg_sql(cid,"SELECT json_build_object('ok',true);",name='postgres')),tries=60)
    # This is called only for the fresh, isolated container created below.
    pg_execute(cid,'postgres','CREATE DATABASE help_preview;')


def probe_candidate(rec):
    context=rec['database'];nonce=rec['nonce'];password=secrets.token_hex(24);secret=secrets.token_hex(32)
    prefix=['docker','run','-d','--pull=never','--label','bos.help293='+nonce,'--pids-limit','128','--cpus','1']
    directory=b.STAGE/'probe-pg';directory.mkdir(mode=0o700)
    # The RU image starts PostgreSQL with data_directory=/var/lib/postgresql/data.
    # Bind only our fresh private directory there; changing PGDATA alone leaves
    # the server using the image's unprepared default directory (observed EXIT=1).
    postgres_env=envfile('probe-pg.env',pg_environment(password))
    aliases=[]
    for name in ('BOS_AUTH_ORIGIN','BOS_REST_ORIGIN','BOS_STORAGE_ORIGIN'):
        host=urllib.parse.urlsplit(rec['environment'][name]).hostname
        aliases+=['--add-host',host+':127.0.0.1']
    args=prefix+['--name','bos-help293-pg-'+nonce,'--network','none','--memory','256m','--memory-swap','256m',*aliases,
                 '--env-file',postgres_env,'--mount','type=bind,src='+str(directory)+',dst=/var/lib/postgresql/data',context['db_image']]
    try:
        pg=invoke(args,'test-db-start');pid=b.assert_isolated(pg)
        prepare_pg(pg)
        with zipfile.ZipFile(Path(__file__).parent) as archive:
            schema=archive.read('schema.sql').decode();seed=archive.read('seed.sql').decode()
        fixture="""DO $roles$ BEGIN
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
          END $roles$;
          CREATE TABLE business_staff(id uuid PRIMARY KEY,external_id text UNIQUE,role text,is_active boolean);
          INSERT INTO business_staff VALUES
          ('00000000-0000-4000-8000-000000000001','preview_owner','owner',true),
          ('00000000-0000-4000-8000-000000000002','preview_manager','manager',true),
          ('00000000-0000-4000-8000-000000000003','preview_master','master',true),
          ('00000000-0000-4000-8000-000000000004','preview_dispatcher','dispatcher',true),
          ('00000000-0000-4000-8000-000000000005','preview_inactive','owner',false);
          GRANT USAGE ON SCHEMA public TO service_role;
          GRANT SELECT ON business_staff TO service_role;
        """
        pg_sql(pg,fixture+schema+seed,write=True)
        rest_port=urllib.parse.urlsplit(rec['environment']['BOS_REST_ORIGIN']).port or 80
        rest_env=envfile('probe-rest.env',{'PGRST_DB_URI':'postgres://supabase_admin:'+password+'@127.0.0.1:5432/help_preview','PGRST_DB_SCHEMAS':'public','PGRST_DB_ANON_ROLE':'anon','PGRST_JWT_SECRET':secret,'PGRST_SERVER_PORT':rest_port,'PGRST_SERVER_HOST':'127.0.0.1','PGRST_DB_POOL':3})
        rest_args=prefix+['--name','bos-help293-rest-'+nonce,'--network','container:'+pg,'--memory','128m','--memory-swap','128m','--env-file',rest_env]
        rest_entry=context['rest_config'].get('Entrypoint') or []
        f.require(len(rest_entry)<=1,'Compound REST entrypoint requires review')
        if rest_entry:rest_args+=['--entrypoint',rest_entry[0]]
        rest=invoke(rest_args+[context['rest_image'],*(context['rest_config'].get('Cmd') or [])],'test-rest-start')
        # Reuse the unmodified RU gateway and routing origins. Docker's shared
        # network namespace inherits the postgres container's loopback host map.
        env={**rec['environment'],'SUPABASE_URL':'http://127.0.0.1:9000','SUPABASE_SERVICE_ROLE_KEY':jwt('service_role',secret),'SUPABASE_ANON_KEY':jwt('anon',secret),'JWT_SECRET':secret,'VK_APP_SECRET':secret}
        test_env=envfile('probe-edge.env',env)
        args=prefix+['--name','bos-help293-edge-'+nonce,'--network','container:'+pg,'--memory','512m','--memory-swap','512m','--user','0:0','--env-file',test_env]
        for folder,dest in b.MOUNTS.items():args+=['--mount','type=bind,src='+str(b.STAGE/folder)+',dst='+dest+',readonly']
        entry=rec['config'].get('Entrypoint') or []
        f.require(len(entry)<=1,'Compound edge entrypoint requires review')
        if entry:args+=['--entrypoint',entry[0]]
        edge=invoke(args+[rec['image'],*(rec['config'].get('Cmd') or [])],'test-edge-start')
        ready(lambda:health_ready(rec,edge))
        ready(lambda:test_api(pid,secret,'ready'))
        test_api(pid,secret,'before')
        # Repeat the production seed after real HTTP edits; it must preserve them.
        pg_sql(pg,seed,write=True)
        # Check persistent storage through actual process restarts, not an in-memory fake.
        for cid,label in [(edge,'edge'),(rest,'rest'),(pg,'postgres')]:invoke(['docker','stop','--time','5',cid],'test-stop-'+label)
        for cid,label in [(pg,'postgres'),(rest,'rest'),(edge,'edge')]:invoke(['docker','start',cid],'test-restart-'+label)
        pid=b.assert_isolated(pg)
        ready(lambda:health_ready(rec,edge))
        ready(lambda:test_api(pid,secret,'ready'))
        test_api(pid,secret,'after')
        f.emit('ISOLATED_RU_POSTGRES_RESTART_AND_REPEAT_SEED=OK')
    finally:
        b.cleanup(rec)
        # Keep a private test DB/logs for diagnosis. It contains only fixture data.


def health_ready(rec,cid):
    pid=b.assert_isolated(cid)
    f.require(b.probe(rec,pid=pid),'Isolated edge not ready')
    return True
