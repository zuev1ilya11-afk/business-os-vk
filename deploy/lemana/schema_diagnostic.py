#!/usr/bin/env python3
"""Read only function defaults and role metadata after a failed PR297 migration.

Uses the installed package's container/fingerprint guards. No row data, DDL,
file writes, service restarts, credentials or arbitrary subprocess output.
"""
import json,sys
from pathlib import Path
QUERY="""SELECT json_build_object(
 'search_path',current_setting('search_path'),
 'defaults',(SELECT coalesce(json_agg(json_build_object('owner',pg_get_userbyid(a.defaclrole),'schema',coalesce(n.nspname,'*'),'grantee',case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY a.defaclrole,a.defaclnamespace,x.grantee,x.privilege_type),'[]'::json)
 FROM pg_default_acl a LEFT JOIN pg_namespace n ON n.oid=a.defaclnamespace CROSS JOIN LATERAL aclexplode(a.defaclacl) x WHERE a.defaclobjtype='f' AND a.defaclrole=(SELECT oid FROM pg_roles WHERE rolname=current_user)),
 'roles',(SELECT json_agg(json_build_object('name',rolname,'superuser',rolsuper,'inherit',rolinherit) ORDER BY rolname) FROM pg_roles WHERE rolname IN ('postgres','anon','authenticated','service_role'))
)"""

def main(package='/root/bos297.pyz'):
    path=Path(package)
    if not path.is_file() or path.is_symlink():raise RuntimeError('Reviewed installed package is required')
    sys.path.insert(0,str(path))
    import database as d
    import release as r
    rec=r.load(d.STAGE)
    if rec is None:raise RuntimeError('Database deployment journal missing')
    result=d.query(rec,QUERY)
    for key,value in result.items():print(key.upper()+'='+json.dumps(value,ensure_ascii=True,separators=(',',':')))
    print('READ_ONLY_METADATA; no orders, files or services changed')

if __name__=='__main__':
    try:main()
    except Exception as error:
        # Never print arbitrary exception values or subprocess diagnostics.
        print('STOP: schema metadata check failed ('+type(error).__name__+')',file=sys.stderr)
        sys.exit(1)
