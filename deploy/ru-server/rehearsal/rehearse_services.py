#!/usr/bin/env python3
"""Run REST/Auth/Storage checks on a separate offline copy of the verified trial."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time

from rehearse_restore import CANDIDATE_IMAGE, resolve_image, stop_trial, validate_backup
from vault_rekey_trial import read_export, PREPARE, COPY, CHECK_METADATA, CHECK_VALUES
from service_trial_files import read_storage_snapshot, materialize_storage, source_mounts, make_jwt
from repair_trial_grants import expected_states, project_state, check_state
from verify_trial_access import validate_baseline, validate_inventory, validate_details

IMAGES={'rest':'postgrest/postgrest:v14.17','auth':'supabase/gotrue:v2.196.0',
        'storage':'supabase/storage-api:v1.80.0'}
DATABASE='bos_restore_check'
STORAGE_COUNT=374
STORAGE_BYTES=23749699
COUNTS_SQL="""BEGIN READ ONLY;
SELECT json_build_object('orders',(SELECT count(*) FROM public.orders),
 'staff',(SELECT count(*) FROM public.business_staff),'auth_users',(SELECT count(*) FROM auth.users),
 'storage_objects',(SELECT count(*) FROM storage.objects),'vault_rows',(SELECT count(*) FROM vault.secrets),
 'cron_enabled',current_setting('cron.launch_active_jobs'));
ROLLBACK;"""
EXPECTED_COUNTS={'orders':114,'staff':14,'auth_users':1,'storage_objects':374,'vault_rows':3,'cron_enabled':'off'}
OBJECTS_SQL="""BEGIN READ ONLY;
SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'bucket_id',bucket_id,'name',name,
 'version',version,'metadata',metadata) ORDER BY id),'[]'::jsonb) FROM storage.objects;
ROLLBACK;"""


def write_env(path, values):
    lines=[]
    for key,value in values.items():
        if not re.fullmatch('[A-Z][A-Z0-9_]*',key) or not isinstance(value,str) or '\n' in value or '\r' in value or '\x00' in value:
            raise ValueError('Invalid environment entry')
        lines.append(key+'='+value+'\n')
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as output:
        output.writelines(lines)
        output.flush()
        os.fsync(output.fileno())


def service_args(name,image,env_file,db_id):
    prefix=name.rsplit('-',1)[0]
    return ['docker','create','--name',name,'--label','bos.service-trial='+prefix,
            '--network','container:'+db_id,'--restart','no','--memory','1g','--cpus','1',
            '--log-opt','max-size=5m','--log-opt','max-file=2','--env-file',str(env_file),image]


class Runner:
    def __init__(self,stage,prefix):
        self.stage,self.prefix,self.created,self.redactions=stage,prefix,[],[]

    def command(self,args,input=None,timeout=60,required=True):
        result=subprocess.run(args,input=input,capture_output=True,timeout=timeout)
        error=result.stderr
        for value in self.redactions:
            if value:
                error=error.replace(value.encode(),b'<redacted>')
        with (self.stage/'commands.log').open('ab') as output:
            output.write(error)
        if required and result.returncode:
            raise RuntimeError('Command failed')
        return result

    def inspect(self,name,optional=False):
        r=self.command(['docker','inspect',name],timeout=20,required=False)
        if r.returncode:
            error=r.stderr.lower()
            if optional and (b'no such object' in error or b'no such container' in error):
                return None
            raise RuntimeError('Container inspection failed')
        return json.loads(r.stdout)[0]

    def create(self,name,args):
        if not name.startswith(self.prefix+'-') or self.inspect(name,optional=True) is not None:
            raise ValueError('Container name is not fresh')
        # Register before create, including when Docker created it but reply is lost.
        self.created.append(name)
        self.command(args,timeout=45)
        info=self.inspect(name)
        if (info['Name']!='/'+name or info['Config'].get('Labels',{}).get('bos.service-trial')!=self.prefix
                or not re.fullmatch('[a-f0-9]{64}',info['Id']) or info['HostConfig'].get('PortBindings')
                or info['HostConfig']['RestartPolicy']['Name']!='no'):
            raise ValueError('Created container isolation mismatch')
        return info['Id']

    def start(self,name):
        self.command(['docker','start',name],timeout=30)

    def sql(self,cid,query,required=True,timeout=60):
        return self.command(['docker','exec','-i',cid,'psql','-X','-w','-qAt','-h','127.0.0.1',
            '-U','bos_restore_loader','-d',DATABASE,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=terse'],
            input=query.encode() if isinstance(query,str) else query,required=required,timeout=timeout)

    def cleanup(self):
        success=True
        for name in reversed(self.created):
            try:
                info=self.inspect(name,optional=True)
                if info is None:
                    continue
                if (info['Name']!='/'+name or info['Config'].get('Labels',{}).get('bos.service-trial')!=self.prefix):
                    success=False
                    continue
                success=stop_trial(name) and success
            except (Exception,KeyboardInterrupt):
                success=False
        return success

    def private_service_logs(self):
        for name in self.created:
            try:
                result=self.command(['docker','logs','--tail','150',name],required=False,timeout=15)
                data=result.stdout+result.stderr
                for secret in self.redactions:
                    data=data.replace(secret.encode(),b'<redacted>')
                (self.stage/(name+'.log')).write_bytes(data)
            except Exception:
                pass


def private_folder(path,parent,prefix):
    info=path.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode&0o077
            or path.resolve(strict=True).parent!=parent or not path.name.startswith(prefix)):
        raise ValueError('Unexpected private source directory')
    return path.resolve()


def resolve_services(runner):
    selected={}
    for role,reference in IMAGES.items():
        print('Подготовка образа:',reference,flush=True)
        runner.command(['docker','pull',reference],timeout=600)
        rows=json.loads(runner.command(['docker','image','inspect',reference],timeout=20).stdout)
        info=rows[0]
        if (len(rows)!=1 or not re.fullmatch('sha256:[a-f0-9]{64}',info.get('Id',''))
                or info.get('Os')!='linux' or info.get('Architecture')!='amd64'
                or not info.get('RepoDigests')):
            raise ValueError('Unexpected service image identity')
        if role=='storage' and info.get('Config',{}).get('User','') not in ('','0','root','0:0','root:root'):
            raise ValueError('Storage file access needs review for changed image user')
        selected[role]={'reference':reference,'image_id':info['Id'],'digests':info['RepoDigests']}
    return selected


def source_identity(info):
    return {k:info['State'].get(k) for k in ('Running','StartedAt','FinishedAt')}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-container',required=True)
    parser.add_argument('--backup',type=Path,required=True)
    parser.add_argument('--storage',type=Path,required=True)
    parser.add_argument('--vault-export',type=Path,required=True)
    parser.add_argument('--edge-secrets',type=Path,help='Include offline Edge/BOS login trial with verified server secrets')
    args=parser.parse_args()
    if os.geteuid()!=0:
        raise ValueError('Run as root')
    os.umask(0o077)
    deploy=Path('/opt/business-os/deploy')
    backup=private_folder(args.backup,Path('/opt/business-os/backups'),'source-')
    storage=private_folder(args.storage,Path('/opt/business-os/backups'),'storage-snapshot-')
    export=private_folder(args.vault_export,deploy,'vault-export-')
    validate_backup(backup)
    with (backup/'source.dump').open('rb') as source:
        source_sha=hashlib.file_digest(source,'sha256').hexdigest()
    snapshot=read_storage_snapshot(storage,source_sha)
    if len(snapshot['objects'])!=STORAGE_COUNT or snapshot['bytes']!=STORAGE_BYTES:
        raise ValueError('Unexpected Storage snapshot size')
    vault=read_export(export)
    folder=Path(__file__).resolve().parent
    queries,baselines={},{}
    for mode,validator in (('inventory',validate_inventory),('details',validate_details)):
        queries[mode]=(folder/f'access_{mode}.sql').read_bytes()
        baselines[mode]=json.loads((folder/f'source_access_{mode}.json').read_bytes())
        validate_baseline(baselines[mode],queries[mode],validator)
    before,after=expected_states(baselines['inventory']['inventory'],baselines['details']['inventory'])
    stage=Path(tempfile.mkdtemp(prefix='service-trial-',dir=deploy))
    prefix='bos-'+stage.name
    runner=Runner(stage,prefix)
    print('Каталог сервисной проверки:',stage,flush=True)
    print('Проверенная БД будет скопирована в отдельный каталог.',flush=True)
    phase='preflight'
    success=False
    report={}

    def interrupted(signum,frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM,interrupted)
    signal.signal(signal.SIGHUP,interrupted)
    try:
        original=runner.inspect(args.source_container)
        data_mount,config_volume=source_mounts(original,args.source_container)
        if not data_mount.is_dir() or data_mount.is_symlink():
            raise ValueError('Source database directory invalid')
        image,image_provenance=resolve_image(CANDIDATE_IMAGE)
        if original['Image']!=image:
            raise ValueError('Source is not the validated candidate image')
        source_state=source_identity(original)
        env=dict(x.split('=',1) for x in original['Config']['Env'])
        loader_password=env.get('PGPASSWORD','')
        if not re.fullmatch('[a-f0-9]{64}',loader_password) or env.get('POSTGRES_PASSWORD')!=loader_password:
            raise ValueError('Unexpected local loader credentials')
        runner.redactions.append(loader_password)
        services=resolve_services(runner)
        (stage/'images.json').write_text(json.dumps({'db':image_provenance,**services},indent=2)+'\n')
        prepared_edge=None
        if args.edge_secrets:
            phase='edge_prepare'
            from edge_trial import prepare_edge, run_edge
            edge_secrets=private_folder(args.edge_secrets,deploy,'runtime-secrets-')
            prepared_edge=prepare_edge(runner,Path('/opt/business-os/backups'),edge_secrets)
        phase='storage_files'
        materialize_storage(snapshot,stage/'storage')
        shutil.copyfile(folder/'service_probe.mjs',stage/'service_probe.mjs')
        phase='clone_database'
        current=runner.inspect(args.source_container)
        source_mounts(current,args.source_container)
        if current['Id']!=original['Id'] or source_identity(current)!=source_state:
            raise ValueError('Source container changed before copy')
        copier=prefix+'-copy'
        copy_args=['docker','create','--name',copier,'--label','bos.service-trial='+prefix,
          '--network','none','--restart','no','--read-only','--user','0','--entrypoint','/bin/sh',
          '--mount',f'type=bind,source={data_mount},target=/source-data,readonly',
          '--mount',f'type=volume,source={config_volume},target=/source-config,readonly',
          '--mount',f'type=bind,source={stage},target=/copy',image,'-ec',
          'test ! -e /source-data/postmaster.pid; test "$(cat /source-data/PG_VERSION)" = 17; '
          'test -z "$(find /source-data /source-config -type l -print -quit)"; '
          'mkdir /copy/data /copy/config; cp -a /source-data/. /copy/data/; cp -a /source-config/. /copy/config/']
        runner.create(copier,copy_args)
        runner.command(['docker','start','--attach',copier],timeout=600)
        if runner.inspect(copier)['State']['ExitCode']!=0:
            raise RuntimeError('Database copy failed')
        current=runner.inspect(args.source_container)
        if current['Id']!=original['Id'] or source_identity(current)!=source_state:
            raise ValueError('Source container changed during copy')
        write_env(stage/'db.env',{'POSTGRES_PASSWORD':loader_password,'PGPASSWORD':loader_password,
            'POSTGRES_DB':'postgres','PGDATABASE':'postgres','PGPORT':'5432','POSTGRES_PORT':'5432',
            'POSTGRES_HOST':'/var/run/postgresql','JWT_EXP':'3600'})
        db_name=prefix+'-db'
        db_args=['docker','create','--name',db_name,'--label','bos.service-trial='+prefix,
          '--network','none','--restart','no','--memory','2g','--cpus','2','--shm-size','256m',
          '--log-opt','max-size=5m','--log-opt','max-file=2','--env-file',str(stage/'db.env'),
          '--mount',f'type=bind,source={stage/"data"},target=/var/lib/postgresql/data',
          '--mount',f'type=bind,source={stage/"config"},target=/etc/postgresql-custom',
          image,'postgres','-c','config_file=/etc/postgresql/postgresql.conf',
          '-c','cron.launch_active_jobs=off','-c','cron.database_name='+DATABASE,'-c','log_min_messages=fatal']
        db=runner.create(db_name,db_args)
        if runner.inspect(db)['HostConfig']['NetworkMode']!='none':
            raise ValueError('Database must have no external network')
        runner.start(db)
        phase='database_ready'
        for _ in range(40):
            ready=runner.sql(db,'SELECT 1;',required=False,timeout=10)
            if ready.returncode==0 and ready.stdout.strip()==b'1':break
            time.sleep(1)
        else:raise RuntimeError('Database startup timeout')
        if json.loads(runner.sql(db,COUNTS_SQL).stdout)!=EXPECTED_COUNTS:
            raise ValueError('Cloned data counts differ')
        state={mode:json.loads(runner.sql(db,query).stdout) for mode,query in queries.items()}
        check_state(project_state(state),before,after,repaired=True)
        expected_objects=sorted([{k:r[k] for k in ('id','bucket_id','name','version','metadata')}
                                 for r in snapshot['objects']],key=lambda r:r['id'])
        if json.loads(runner.sql(db,OBJECTS_SQL).stdout)!=expected_objects:
            raise ValueError('Storage metadata differs from file snapshot')
        phase='vault_check'
        result=runner.command(['docker','exec','-i',db,'psql','-X','-w','-qAt','-h','127.0.0.1',
          '-U','bos_restore_loader','-d',DATABASE,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=terse',
          '-c',PREPARE,'-c',COPY,'-c',CHECK_METADATA+CHECK_VALUES+'ROLLBACK;',
          '-c',"SELECT 'BOS_VAULT_VALUES_OK'"],input=vault)
        if result.stdout.strip()!=b'BOS_VAULT_VALUES_OK':raise RuntimeError('Vault comparison failed')
        del vault
        phase='local_service_credentials'
        db_password=secrets.token_hex(32)
        jwt_secret=secrets.token_hex(48)
        anon,service=make_jwt(jwt_secret,'anon'),make_jwt(jwt_secret,'service_role')
        runner.redactions.extend([db_password,jwt_secret,anon,service])
        credentials_sql="""BEGIN;
SET LOCAL log_statement='none'; SET LOCAL log_min_error_statement='panic'; SET LOCAL pgaudit.log='none';
""" + ''.join(f"ALTER ROLE {role} PASSWORD '{db_password}';\n" for role in (
            'authenticator','supabase_auth_admin','supabase_storage_admin'))+'COMMIT;'
        runner.sql(db,credentials_sql)
        pg_url=lambda role:f'postgres://{role}:{db_password}@127.0.0.1:5432/{DATABASE}'
        write_env(stage/'rest.env',{'PGRST_DB_URI':pg_url('authenticator'),'PGRST_DB_SCHEMAS':'public',
          'PGRST_DB_ANON_ROLE':'anon','PGRST_JWT_SECRET':jwt_secret,'PGRST_SERVER_HOST':'127.0.0.1',
          'PGRST_SERVER_PORT':'3000','PGRST_DB_MAX_ROWS':'1000','PGRST_LOG_LEVEL':'error'})
        write_env(stage/'auth.env',{'GOTRUE_API_HOST':'127.0.0.1','GOTRUE_API_PORT':'9999',
          'API_EXTERNAL_URL':'http://127.0.0.1:9999','GOTRUE_DB_DRIVER':'postgres',
          'GOTRUE_DB_DATABASE_URL':pg_url('supabase_auth_admin'),'GOTRUE_SITE_URL':'http://127.0.0.1',
          'GOTRUE_DISABLE_SIGNUP':'true','GOTRUE_JWT_SECRET':jwt_secret,'GOTRUE_JWT_ADMIN_ROLES':'service_role',
          'GOTRUE_JWT_AUD':'authenticated','GOTRUE_JWT_DEFAULT_GROUP_NAME':'authenticated',
          'GOTRUE_JWT_EXP':'3600','GOTRUE_EXTERNAL_EMAIL_ENABLED':'true',
          'GOTRUE_EXTERNAL_PHONE_ENABLED':'false','GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED':'false',
          'GOTRUE_MAILER_AUTOCONFIRM':'false','GOTRUE_LOG_LEVEL':'error'})
        write_env(stage/'storage.env',{'ANON_KEY':anon,'SERVICE_KEY':service,'AUTH_JWT_SECRET':jwt_secret,
          'POSTGREST_URL':'http://127.0.0.1:3000','DATABASE_URL':pg_url('supabase_storage_admin'),
          'DATABASE_MAX_CONNECTIONS':'8','STORAGE_BACKEND':'file','FILE_STORAGE_BACKEND_PATH':'/var/lib/storage',
          'GLOBAL_S3_BUCKET':'stub','TENANT_ID':'stub','REGION':'local','FILE_SIZE_LIMIT':'52428800',
          'STORAGE_PUBLIC_URL':'http://127.0.0.1:5000','ENABLE_IMAGE_TRANSFORMATION':'false',
          'TUS_USE_FILE_VERSION_SEPARATOR':'false','STORAGE_FILE_ETAG_ALGORITHM':'md5',
          'S3_PROTOCOL_ENABLED':'false','LOG_LEVEL':'error'})
        probe={'service_key':service,'anon_key':anon,'expected_orders':114,'expected_auth_users':1,
               'bucket':'business-os-vk-files','objects':[{'name':r['name'],'size':r['metadata']['size'],
                 'sha256':r['sha256'],'mimetype':r['mimetype']} for r in snapshot['objects']]}
        (stage/'probe-config.json').write_text(json.dumps(probe))
        phase='start_services'
        storage_id=None
        for role in ('rest','auth','storage'):
            name=prefix+'-'+role
            command=service_args(name,services[role]['image_id'],stage/(role+'.env'),db)
            if role=='storage':
                command[-1:-1]=['--mount',f'type=bind,source={stage/"storage"},target=/var/lib/storage',
                  '--mount',f'type=bind,source={stage/"service_probe.mjs"},target=/bos/service_probe.mjs,readonly',
                  '--mount',f'type=bind,source={stage/"probe-config.json"},target=/bos/probe-config.json,readonly']
                if prepared_edge:
                    command[-1:-1]=['--mount',f'type=bind,source={prepared_edge["root"]/"probe"},target=/bos-edge,readonly']
            cid=runner.create(name,command)
            if runner.inspect(cid)['HostConfig']['NetworkMode']!='container:'+db:
                raise ValueError('Service is not confined to clone namespace')
            runner.start(cid)
            if role=='storage':storage_id=cid
        phase='services_ready'
        for _ in range(60):
            result=runner.command(['docker','exec',storage_id,'node','/bos/service_probe.mjs','--ready'],
                                  required=False,timeout=20)
            if result.returncode==0:break
            if any(not runner.inspect(prefix+'-'+role)['State']['Running'] for role in ('rest','auth','storage')):
                raise RuntimeError('Service exited during startup')
            time.sleep(2)
        else:raise RuntimeError('Service health timeout')
        phase='http_probe'
        print('Проверка REST, Auth и 374 файлов через Storage API...',flush=True)
        result=runner.command(['docker','exec',storage_id,'node','/bos/service_probe.mjs','/bos/probe-config.json'],
                              required=False,timeout=600)
        api=json.loads(result.stdout)
        if result.returncode:
            print('Проверка API не завершена:',json.dumps({k:api.get(k) for k in ('phase','http')}),flush=True)
            raise RuntimeError('API probe failed')
        required=('rest_read','rest_anon_denied','auth_admin_read','auth_anon_denied','storage_private_denied',
                  'storage_write_cycle','storage_signed_read')
        if (not all(api.get(k) is True for k in required) or api.get('storage_objects')!=STORAGE_COUNT
                or api.get('storage_bytes')!=STORAGE_BYTES):raise ValueError('API proof incomplete')
        edge_report=None
        if prepared_edge:
            phase='edge_runtime_probe'
            edge_report=run_edge(runner,prepared_edge,db,storage_id,
                                 {'jwt_secret':jwt_secret,'anon':anon,'service':service})
        phase='postcheck'
        counts=json.loads(runner.sql(db,COUNTS_SQL).stdout)
        if counts!=EXPECTED_COUNTS or json.loads(runner.sql(db,OBJECTS_SQL).stdout)!=expected_objects:
            raise ValueError('Post-service original data inventory differs')
        current=runner.inspect(args.source_container)
        if current['Id']!=original['Id'] or source_identity(current)!=source_state:
            raise ValueError('Original trial state changed')
        report={'api':api,'counts':counts,'vault_values_verified':3,'source_container':args.source_container,
                'source_dump_sha256':source_sha,'image_ids':{'db':image,**{k:v['image_id'] for k,v in services.items()}},
                'scope':'offline REST/Auth-admin/Storage trial; no app login, Edge Functions or cutover verified'}
        if edge_report:
            report['edge']=edge_report
            report['scope']='offline core services and synthetic BOS login/bootstrap; no browser UI, external integrations, HTTPS or cutover'
        success=True
    except (Exception,KeyboardInterrupt):
        print('BOS_SERVICE_TRIAL_FAILED phase='+phase,flush=True)
        runner.private_service_logs()
    finally:
        if not runner.cleanup():
            print('BOS_SERVICE_TRIAL_STOP_FAILED',flush=True)
            success=False
        else:print('Все созданные пробные контейнеры остановлены.',flush=True)
    if success:
        report['all_trial_containers_stopped']=True
        with (stage/'report.json').open('x') as output:
            json.dump(report,output,ensure_ascii=False,indent=2)
            output.flush()
            os.fsync(output.fileno())
        print('Проверено:',json.dumps(report['api'],ensure_ascii=False),flush=True)
        print('BOS_SERVICE_TRIAL_OK',flush=True)
        if report.get('edge'):
            print('Проверка BOS:',json.dumps({k:v for k,v in report['edge'].items()
                                            if k not in ('image_id','function_snapshot','scope')},ensure_ascii=False),flush=True)
            print('BOS_EDGE_TRIAL_OK',flush=True)
            print('Вход проверен через API на временном сотруднике. Браузер, интеграции, HTTPS и переключение ещё впереди.')
        else:print('Edge Functions, вход в приложение, HTTPS и финальное переключение ещё впереди.')
        return 0
    print('Файлы и закрытый журнал сохранены; полный журнал в чат не отправляйте.',flush=True)
    return 1


if __name__=='__main__':
    try:sys.exit(main())
    except (Exception,KeyboardInterrupt):
        print('BOS_SERVICE_TRIAL_PREFLIGHT_FAILED',flush=True)
        sys.exit(1)
