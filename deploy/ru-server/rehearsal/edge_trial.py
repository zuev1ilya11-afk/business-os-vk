"""Compile-only online preparation, followed by isolated BOS login/API trial."""
import hashlib
import json
from pathlib import Path
import re
import secrets
import shutil
import time
import uuid

from edge_trial_files import assemble, find_snapshot, read_verified_secrets
from rehearse_restore import stop_trial

EDGE_IMAGE='supabase/edge-runtime:v1.76.2'
TABLE_HASHES="""SELECT json_build_object(
 'staff',(SELECT md5(coalesce(string_agg(row_to_json(t)::text,E'\\n' ORDER BY id),'')) FROM public.business_staff t),
 'orders',(SELECT md5(coalesce(string_agg(row_to_json(t)::text,E'\\n' ORDER BY id),'')) FROM public.orders t),
 'rate',(SELECT md5(coalesce(string_agg(row_to_json(t)::text,E'\\n' ORDER BY key_hash),'')) FROM public.bos_login_rate_limits t));"""
QUIET="BEGIN; SET LOCAL log_statement='none'; SET LOCAL log_min_error_statement='panic'; SET LOCAL pgaudit.log='none';\n"


def container_args(name,network):
    return ['docker','create','--name',name,'--label','bos.service-trial='+name.split('-build-')[0].removesuffix('-edge'),
            '--network',network,'--restart','no','--user','0','--read-only',
            '--memory','1g','--cpus','1','--log-opt','max-size=5m','--log-opt','max-file=2',
            '--tmpfs','/tmp:rw,nosuid,size=512m','--env','DENO_DIR=/tmp/deno',
            '--entrypoint','/usr/local/bin/edge-runtime']


def build_args(name,image,root,slug,route):
    args=container_args(name,'bridge')
    args+=['--env','DENO_DIR=/bos-cache',
           '--mount',f'type=bind,source={root/"sources"/slug},target=/bos-src/{slug},readonly',
           '--mount',f'type=bind,source={root/"bundles"},target=/bos-bundles',
           '--mount',f'type=bind,source={root/"cache"},target=/bos-cache',
           image,'bundle','--entrypoint','/bos-src/'+slug+'/'+route['entrypoint'],
           '--output','/bos-bundles/'+slug+'.eszip','--timeout','300']
    if route['import_map']:args+=['--import-map','/bos-src/'+slug+'/'+route['import_map']]
    return args


def runtime_args(name,image,root,db):
    args=container_args(name,'container:'+db)
    args+=['--env-file',str(root/'runtime.env')]
    for local,target in [('sources','/bos-src'),('bundles','/bos-bundles'),('main','/bos-main')]:
        args+=['--mount',f'type=bind,source={root/local},target={target},readonly']
    return args+[image,'start','--main-service','/bos-main','--ip','127.0.0.1','--port','9000']


def prepare_edge(runner,snapshot,secrets_dir):
    folder=Path(__file__).resolve().parent
    baseline=json.loads((folder/'edge_source_baseline.json').read_bytes())
    source,functions=find_snapshot(snapshot,baseline)
    if len(functions)!=35 or sum(len(f['files']) for f in functions)!=57:
        raise ValueError('Unexpected function snapshot counts')
    values=read_verified_secrets(secrets_dir)
    runner.redactions.extend(values.values())
    root=runner.stage/'edge';root.mkdir(mode=0o700)
    routes=assemble(functions,root/'sources')
    for name in ('bundles','cache','main','probe'):(root/name).mkdir(mode=0o700)
    shutil.copyfile(folder/'edge_router.mjs',root/'main/index.ts')
    shutil.copyfile(folder/'edge_probe.mjs',root/'probe/edge_probe.mjs')
    (root/'main/routes.json').write_text(json.dumps(routes,sort_keys=True)+'\n')
    print('Подготовка образа:',EDGE_IMAGE,flush=True)
    runner.command(['docker','pull',EDGE_IMAGE],timeout=600)
    infos=json.loads(runner.command(['docker','image','inspect',EDGE_IMAGE],timeout=20).stdout)
    info=infos[0]
    if (len(infos)!=1 or not re.fullmatch('sha256:[a-f0-9]{64}',info.get('Id','')) or
        info.get('Os')!='linux' or info.get('Architecture')!='amd64' or not info.get('RepoDigests')):
        raise ValueError('Unexpected Edge image identity')
    image=info['Id']
    provenance={'reference':EDGE_IMAGE,'image_id':image,'digests':info['RepoDigests']}
    (root/'image.json').write_text(json.dumps(provenance,indent=2)+'\n')
    # No database is running yet; builders receive source and empty cache/output only.
    for n,(slug,route) in enumerate(sorted(routes.items()),1):
        print(f'Сборка Edge Functions: {n}/{len(routes)} ({slug})',flush=True)
        name=runner.prefix+'-build-'+slug
        cid=runner.create(name,build_args(name,image,root,slug,route))
        current=runner.inspect(cid)
        if current['HostConfig']['NetworkMode']!='bridge':raise ValueError('Build network mismatch')
        try:
            runner.command(['docker','start','--attach',cid],timeout=330)
            current=runner.inspect(cid)
            if current['State']['Running'] or current['State']['ExitCode']!=0:raise RuntimeError('Bundle failed')
        finally:
            if not stop_trial(name):raise RuntimeError('Builder stop failed')
        bundle=root/'bundles'/(slug+'.eszip')
        if bundle.is_symlink() or not bundle.is_file() or not 0<bundle.stat().st_size<=128*1024*1024:
            raise ValueError('Missing or invalid bundle')
        route['bundle_sha256']=hashlib.sha256(bundle.read_bytes()).hexdigest()
    (root/'bundles.json').write_text(json.dumps(routes,sort_keys=True,indent=2)+'\n')
    print('Собрано функций: 35. Подготовка изолированной проверки входа BOS...',flush=True)
    return {'root':root,'routes':routes,'values':values,'image':image,'provenance':provenance,'snapshot':str(source)}


def new_fixture():
    identifier=str(uuid.uuid4()); login='bos_probe_'+secrets.token_hex(12)
    return {'id':identifier,'external_id':'bos_probe_'+identifier.replace('-',''),
            'login':login,'password':secrets.token_hex(24),
            'rate_hash':hashlib.sha256(('pair\nunknown\n'+login).encode()).hexdigest()}


def with_fixture(runner,db,fixture,probe):
    f=fixture
    # Only generated literal-safe fields enter SQL, always via stdin, never argv.
    if (not re.fullmatch(r'[a-f0-9-]{36}',f['id']) or
        any(not re.fullmatch(r'[a-z0-9_]+',f[k]) for k in ('external_id','login','password','rate_hash'))):
        raise ValueError('Invalid probe fixture')
    guard=f"""DO $bos$ BEGIN
 IF EXISTS(SELECT 1 FROM public.business_staff WHERE id='{f['id']}' OR external_id='{f['external_id']}' OR lower(login)='{f['login']}')
 OR EXISTS(SELECT 1 FROM public.bos_login_rate_limits WHERE key_hash='{f['rate_hash']}') THEN RAISE EXCEPTION 'Probe collision'; END IF;
 IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid IN ('public.business_staff'::regclass,'public.bos_login_rate_limits'::regclass)
  AND NOT tgisinternal AND tgenabled<>'D' AND (tgtype & 4<>0 OR tgtype & 8<>0)) THEN RAISE EXCEPTION 'Unaudited fixture trigger'; END IF;
END $bos$;
"""
    before=json.loads(runner.sql(db,'BEGIN READ ONLY;\n'+guard+TABLE_HASHES+'ROLLBACK;').stdout)
    try:
        runner.sql(db,QUIET+guard+f"""INSERT INTO public.business_staff(id,external_id,full_name,role,city,is_active)
VALUES('{f['id']}','{f['external_id']}','BOS isolated migration probe','owner','Москва',true);
SELECT public.bos_set_staff_credentials('{f['id']}','{f['login']}','{f['password']}'); COMMIT;""")
        return probe()
    finally:
        # Preflight proved these random identifiers did not belong to original rows.
        runner.sql(db,QUIET+f"""DELETE FROM public.business_staff
WHERE id='{f['id']}' AND external_id='{f['external_id']}' AND login='{f['login']}';
DELETE FROM public.bos_login_rate_limits WHERE key_hash='{f['rate_hash']}'; COMMIT;""")
        after=json.loads(runner.sql(db,'BEGIN READ ONLY;'+TABLE_HASHES+'ROLLBACK;').stdout)
        if after!=before:raise ValueError('Original rows changed after Edge probe')


def run_edge(runner,prepared,db,storage_id,credentials):
    from rehearse_services import write_env
    root=prepared['root'];f=new_fixture();runner.redactions.append(f['password'])
    values=prepared['values']
    write_env(root/'runtime.env',{**values,'JWT_SECRET':credentials['jwt_secret'],
       'SUPABASE_URL':'http://127.0.0.1:9000','SUPABASE_ANON_KEY':credentials['anon'],
       'SUPABASE_SERVICE_ROLE_KEY':credentials['service']})
    config={'fixture':f,'vk_secret':values['VK_APP_SECRET'],
            'protected_slugs':[slug for slug,r in prepared['routes'].items() if r['verify_jwt']]}
    (root/'probe/config.json').write_text(json.dumps(config)+'\n')
    name=runner.prefix+'-edge'

    def probe():
        try:
            cid=runner.create(name,runtime_args(name,prepared['image'],root,db))
            if runner.inspect(cid)['HostConfig']['NetworkMode']!='container:'+db:
                raise ValueError('Edge namespace mismatch')
            runner.start(cid)
            for _ in range(40):
                ready=runner.command(['docker','exec',storage_id,'node','/bos-edge/edge_probe.mjs','--ready'],
                                     required=False,timeout=30)
                if ready.returncode==0:break
                if not runner.inspect(cid)['State']['Running']:raise RuntimeError('Edge exited')
                time.sleep(1)
            else:raise RuntimeError('Edge readiness timeout')
            print('Проверка входа, сессии и данных BOS...',flush=True)
            result=runner.command(['docker','exec',storage_id,'node','/bos-edge/edge_probe.mjs','/bos-edge/config.json'],
                                  required=False,timeout=300)
            report=json.loads(result.stdout)
            if result.returncode:
                print('Проверка BOS не завершена:',json.dumps({k:report.get(k) for k in ('phase','http')}),flush=True)
                raise RuntimeError('BOS probe failed')
            booleans=('bos_anon_denied','bos_bad_password_denied','bos_password_login','bos_session_refresh',
                      'bos_signature_verified','bos_invalid_session_denied','bos_credentials_hidden')
            if (not all(report.get(k) is True for k in booleans) or report.get('bos_bootstrap_orders')!=114 or
                report.get('jwt_required_denied')!=len(config['protected_slugs'])):
                raise ValueError('Incomplete BOS probe proof')
            return report
        finally:
            # Stop workers before deleting the fixture, including after probe timeout.
            info=runner.inspect(name,optional=True)
            if info is not None:
                if info['Config'].get('Labels',{}).get('bos.service-trial')!=runner.prefix or not stop_trial(name):
                    raise RuntimeError('Edge stop failed')
    result=with_fixture(runner,db,f,probe)
    return {**result,'bundled_functions':len(prepared['routes']),'fixture_removed':True,
            'original_row_hashes_match':True,'image_id':prepared['image'],
            'function_snapshot':prepared['snapshot'],'scope':'offline synthetic BOS login and bootstrap; not browser UI or integrations'}
