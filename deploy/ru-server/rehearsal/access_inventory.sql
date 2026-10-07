-- Catalog metadata only. No application rows, secret values or function bodies.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog;
WITH
ns AS (
  SELECT oid,nspname,nspowner,nspacl FROM pg_namespace
  WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'
),
rels AS (
  SELECT c.*,n.nspname FROM pg_class c JOIN ns n ON n.oid=c.relnamespace
  WHERE c.relkind IN ('r','p','v','m','S','f')
),
procs AS (
  SELECT p.*,n.nspname FROM pg_proc p JOIN ns n ON n.oid=p.pronamespace
),
ext_members AS (
  SELECT d.classid,d.objid,e.extname FROM pg_depend d JOIN pg_extension e
    ON d.refclassid='pg_extension'::regclass AND d.refobjid=e.oid
  WHERE d.deptype='e'
),
raw_acl AS (
  SELECT 'schemas'::text AS category,format('%I',nspname) AS object_id,
         COALESCE(nspacl,acldefault('n',nspowner)) AS acl FROM ns
  UNION ALL
  SELECT 'relations',format('%I.%I',nspname,relname),
         COALESCE(relacl,acldefault(CASE WHEN relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,relowner))
  FROM rels r WHERE NOT EXISTS (SELECT FROM ext_members e WHERE e.classid='pg_class'::regclass AND e.objid=r.oid)
  UNION ALL
  SELECT 'columns',format('%I.%I.%I',r.nspname,r.relname,a.attname),a.attacl
  FROM rels r JOIN pg_attribute a ON a.attrelid=r.oid
  WHERE a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
  UNION ALL
  SELECT 'functions',format('%I.%I(%s)',nspname,proname,pg_get_function_identity_arguments(p.oid)),
         COALESCE(proacl,acldefault('f',proowner))
  FROM procs p WHERE NOT EXISTS (SELECT FROM ext_members e WHERE e.classid='pg_proc'::regclass AND e.objid=p.oid)
  UNION ALL
  SELECT 'default_acl',format('%I|%s|%s',pg_get_userbyid(d.defaclrole),COALESCE(n.nspname,''),d.defaclobjtype),d.defaclacl
  FROM pg_default_acl d LEFT JOIN ns n ON n.oid=d.defaclnamespace
  WHERE d.defaclnamespace=0 OR n.oid IS NOT NULL
),
acl_rows AS (
  SELECT a.category,a.object_id,jsonb_build_array(
    pg_get_userbyid(x.grantor),CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
    x.privilege_type,x.is_grantable) AS value
  FROM raw_acl a CROSS JOIN LATERAL aclexplode(a.acl) x
),
acl_norm AS (
  SELECT category,object_id,jsonb_agg(value ORDER BY value::text COLLATE "C") AS value
  FROM acl_rows GROUP BY category,object_id
),
rows AS (
  SELECT 'schema_metadata' AS category,format('%I',nspname) AS object_id,
    jsonb_build_array(pg_get_userbyid(nspowner),COALESCE(a.value,'[]'::jsonb)) AS value
  FROM ns LEFT JOIN acl_norm a ON a.category='schemas' AND a.object_id=format('%I',nspname)
  UNION ALL
  SELECT 'relation_metadata',format('%I.%I',r.nspname,r.relname),
    jsonb_build_array(r.relkind,pg_get_userbyid(r.relowner),r.relrowsecurity,r.relforcerowsecurity,COALESCE(a.value,'[]'::jsonb))
  FROM rels r LEFT JOIN acl_norm a ON a.category='relations' AND a.object_id=format('%I.%I',r.nspname,r.relname)
  WHERE NOT EXISTS (SELECT FROM ext_members e WHERE e.classid='pg_class'::regclass AND e.objid=r.oid)
  UNION ALL
  SELECT 'column_acl',object_id,value FROM acl_norm WHERE category='columns'
  UNION ALL
  SELECT 'function_metadata',format('%I.%I(%s)',p.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),
    jsonb_build_array(pg_get_userbyid(p.proowner),p.prokind,p.prosecdef,p.proleakproof,
      md5(COALESCE(array_to_string(p.proconfig,E'\n'),'')),COALESCE(a.value,'[]'::jsonb))
  FROM procs p LEFT JOIN acl_norm a ON a.category='functions'
    AND a.object_id=format('%I.%I(%s)',p.nspname,p.proname,pg_get_function_identity_arguments(p.oid))
  WHERE NOT EXISTS (SELECT FROM ext_members e WHERE e.classid='pg_proc'::regclass AND e.objid=p.oid)
  UNION ALL
  SELECT 'default_acl',r.object_id,COALESCE(a.value,'[]'::jsonb)
  FROM raw_acl r LEFT JOIN acl_norm a USING (category,object_id)
  WHERE r.category='default_acl'
  UNION ALL
  SELECT 'policies',format('%I.%I|%I',r.nspname,r.relname,p.polname),
    jsonb_build_array(p.polcmd,p.polpermissive,
      (SELECT jsonb_agg(name ORDER BY name COLLATE "C") FROM (
        SELECT CASE WHEN x=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x) END AS name FROM unnest(p.polroles) x) q),
      pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid))
  FROM pg_policy p JOIN rels r ON r.oid=p.polrelid
  UNION ALL
  SELECT 'roles',rolname,jsonb_build_array(rolsuper,rolinherit,rolcreaterole,rolcreatedb,
      rolcanlogin,rolreplication,rolbypassrls,rolconnlimit)
  FROM pg_roles WHERE rolname !~ '^pg_' AND rolname <> 'bos_restore_loader'
  UNION ALL
  SELECT 'memberships',format('%I|%I|%I',pg_get_userbyid(roleid),pg_get_userbyid(member),pg_get_userbyid(grantor)),
      jsonb_build_array(admin_option,inherit_option,set_option)
  FROM pg_auth_members WHERE pg_get_userbyid(member) !~ '^pg_'
    AND 'bos_restore_loader' NOT IN (pg_get_userbyid(roleid),pg_get_userbyid(member),pg_get_userbyid(grantor))
  UNION ALL
  SELECT 'extension_member_owners',format('%s|function|%I.%I(%s)',e.extname,p.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),
    to_jsonb(pg_get_userbyid(p.proowner))
  FROM procs p JOIN ext_members e ON e.classid='pg_proc'::regclass AND e.objid=p.oid
  UNION ALL
  SELECT 'extension_member_owners',format('%s|relation|%I.%I',e.extname,r.nspname,r.relname),
    to_jsonb(pg_get_userbyid(r.relowner))
  FROM rels r JOIN ext_members e ON e.classid='pg_class'::regclass AND e.objid=r.oid
  UNION ALL
  SELECT 'extension_function_access',format('%s|%I.%I(%s)|%s',e.extname,p.nspname,p.proname,pg_get_function_identity_arguments(p.oid),role_name),
    jsonb_build_array(p.prosecdef,has_function_privilege(role_name,p.oid,'EXECUTE'))
  FROM procs p JOIN ext_members e ON e.classid='pg_proc'::regclass AND e.objid=p.oid
  CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role'),('authenticator'),
    ('supabase_auth_admin'),('supabase_storage_admin'),('supabase_realtime_admin')) roles(role_name)
  UNION ALL
  SELECT 'extension_relation_access',format('%s|%I.%I|%s|%s',e.extname,r.nspname,r.relname,role_name,privilege),
    jsonb_build_array(r.relkind,r.relrowsecurity,r.relforcerowsecurity,has_table_privilege(role_name,r.oid,privilege))
  FROM rels r JOIN ext_members e ON e.classid='pg_class'::regclass AND e.objid=r.oid
  CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role'),('authenticator'),
    ('supabase_auth_admin'),('supabase_storage_admin'),('supabase_realtime_admin')) roles(role_name)
  CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) privileges(privilege)
  WHERE r.relkind <> 'S'
  UNION ALL
  SELECT 'extension_sequence_access',format('%s|%I.%I|%s|%s',e.extname,r.nspname,r.relname,role_name,privilege),
    to_jsonb(has_sequence_privilege(role_name,r.oid,privilege))
  FROM rels r JOIN ext_members e ON e.classid='pg_class'::regclass AND e.objid=r.oid
  CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role'),('authenticator'),
    ('supabase_auth_admin'),('supabase_storage_admin'),('supabase_realtime_admin')) roles(role_name)
  CROSS JOIN (VALUES ('USAGE'),('SELECT'),('UPDATE')) privileges(privilege)
  WHERE r.relkind='S'
),
categories(category) AS (VALUES ('schema_metadata'),('relation_metadata'),('column_acl'),
 ('function_metadata'),('default_acl'),('policies'),('roles'),('memberships'),('extension_member_owners'),
 ('extension_function_access'),('extension_relation_access'),('extension_sequence_access')),
summary AS (
  SELECT c.category,count(r.object_id) AS objects,
    md5(COALESCE(string_agg(jsonb_build_array(r.object_id,r.value)::text,E'\n'
      ORDER BY r.object_id COLLATE "C",r.value::text COLLATE "C") FILTER (WHERE r.object_id IS NOT NULL),'')) AS fingerprint
  FROM categories c LEFT JOIN rows r ON r.category=c.category GROUP BY c.category
)
SELECT json_build_object(
  'categories',(SELECT json_object_agg(category,json_build_object('objects',objects,'fingerprint',fingerprint)) FROM summary),
  'database_grants',(SELECT jsonb_agg(jsonb_build_array(
    pg_get_userbyid(a.grantor),CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
    a.privilege_type,a.is_grantable) ORDER BY
    (CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) COLLATE "C",a.privilege_type COLLATE "C")
    FROM pg_database d CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a
    WHERE d.datname=current_database()),
  'database_owner',(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()),
  'extension_owners',(SELECT json_object_agg(extname,pg_get_userbyid(extowner)) FROM pg_extension)
) AS access_inventory;
ROLLBACK;
