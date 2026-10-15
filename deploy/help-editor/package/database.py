"""Only the isolated help table may be created in the verified live database."""
import json
import re
import subprocess
import urllib.parse
import frontend as f
import check_server as check

SHELL='export PGPASSWORD="${PGPASSWORD:-$POSTGRES_PASSWORD}"; exec psql -X -w -U "${POSTGRES_USER:-postgres}" -d "$1" -qAt -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate'
TABLE='public.master_help_materials'
COLUMNS=[('id','text'),('kind','text'),('content','jsonb'),('version','integer'),('sort_order','integer'),('created_at','timestamp with time zone'),('updated_at','timestamp with time zone'),('updated_by','text')]


def sql(cid,name,statement,write=False):
    wrapper=('BEGIN;' if write else 'BEGIN READ ONLY;')+" SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='5s'; "+statement+(' COMMIT;' if write else ' ROLLBACK;')
    args=['docker','exec','-i',cid,'sh','-c',SHELL,'help-metadata',name]
    try:
        r=subprocess.run(args,input=wrapper.encode(),capture_output=True,timeout=25)
        if r.returncode:
            code=re.search(rb'(?:ERROR|FATAL):\s+([A-Z0-9]{5})(?:\s|$)',r.stderr)
            raise f.Stop('Help database query failed'+(' SQLSTATE_'+code[1].decode() if code else '')+'; no credentials printed')
        return r.stdout.decode().strip()
    except (OSError,subprocess.SubprocessError):raise f.Stop('Help database query unavailable; check saved deployment state') from None


def metadata(context):
    return json.loads(sql(context['db'],context['name'],"""SELECT json_build_object(
      'exists',to_regclass('public.master_help_materials') IS NOT NULL,
      'marker',obj_description(to_regclass('public.master_help_materials'),'pg_class'),
      'service_bypass',(SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname='service_role'),
      'roles',(SELECT json_agg(rolname ORDER BY rolname) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')),
      'columns',(SELECT json_agg(json_build_array(column_name,data_type) ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='master_help_materials'));"""))


def discover():
    ids=f.command(['docker','ps','-q']).decode().split()
    rows=json.loads(f.command(['docker','inspect',*ids]))
    result=check.database_report(rows,lambda args:f.command(args).decode())
    f.require(result.get('status')=='OK' and result.get('target_source')=='verified active release','Verified active database metadata unavailable: '+str(result.get('status')))
    f.require({'owner','manager','master'}<=set(result.get('active_roles') or []),'Expected active staff role identifiers not found')
    edge=next(c for c in rows if re.fullmatch(r'/bos-release-.+-edge',c['Name']))
    rest=next(c for c in rows if c['Name']==edge['Name'][:-5]+'-rest')
    db=next(c for c in rows if c['Name']==edge['Name'][:-5]+'-db')
    name=urllib.parse.unquote(urllib.parse.urlsplit(check.container_env(rest)['PGRST_DB_URI']).path.lstrip('/'))
    context=dict(db=db['Id'],rest=rest['Id'],name=name,db_fingerprint=f.fingerprint(db),rest_fingerprint=f.fingerprint(rest),db_image=db['Image'],rest_image=rest['Image'],rest_config={k:rest['Config'].get(k) for k in ['Entrypoint','Cmd']})
    meta=metadata(context)
    f.require(meta['service_bypass'] is True and set(meta['roles'])=={'anon','authenticated','service_role'},'Existing PostgreSQL service role grants require review')
    return context,meta


def verify(context):
    current,_=discover()
    f.require(current==context,'Active database/REST target changed; deployment stopped')


def owned(meta,marker):
    return meta['exists'] and meta['marker']==marker and meta['columns']==[list(c) for c in COLUMNS]


def migrate(context,marker,schema,seed):
    f.require(re.fullmatch(r'bos-help293:[a-f0-9]{32}',marker),'Invalid deployment marker')
    verify(context)
    existing=metadata(context)
    if existing['exists']:
        f.require(owned(existing,marker),'Help table is not owned by this saved release')
        # Retry after rollback: retain every employee edit and version.
        sql(context['db'],context['name'],"NOTIFY pgrst, 'reload schema';",write=True)
        return
    # Fail atomically if another deployment created a table after preparation.
    # Existing rows are never truncated, dropped or updated by the seed.
    statement="""DO $guard$ BEGIN
      PERFORM pg_advisory_xact_lock(293,1);
      IF to_regclass('public.master_help_materials') IS NOT NULL THEN
        RAISE EXCEPTION 'Help table appeared after preparation';
      END IF;
    END $guard$;
    """+schema+"\nCOMMENT ON TABLE public.master_help_materials IS '"+marker+"';\n"+seed
    sql(context['db'],context['name'],statement,write=True)
    f.require(owned(metadata(context),marker),'Created help table failed verification')
    counts=json.loads(sql(context['db'],context['name'],"SELECT json_build_object('count',count(*),'versions',bool_and(version=1)) FROM public.master_help_materials;"))
    f.require(counts=={'count':31,'versions':True},'Initial help content verification failed')
    # PostgREST schema reload is sent only after the transaction commits.
    sql(context['db'],context['name'],"NOTIFY pgrst, 'reload schema';",write=True)
