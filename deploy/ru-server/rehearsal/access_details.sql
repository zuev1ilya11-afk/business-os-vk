-- Read-only details for the two differing access-inventory categories.
BEGIN READ ONLY;
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog;
WITH ns AS (
  SELECT oid,nspname,nspowner,nspacl FROM pg_namespace
  WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'
), schemas AS (
  SELECT format('%I',n.nspname) AS object_id,
    jsonb_build_array(pg_get_userbyid(n.nspowner),COALESCE(a.acl,'[]'::jsonb)) AS value
  FROM ns n CROSS JOIN LATERAL (
    SELECT jsonb_agg(value ORDER BY value::text COLLATE "C") AS acl FROM (
      SELECT jsonb_build_array(pg_get_userbyid(x.grantor),
        CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
        x.privilege_type,x.is_grantable) AS value
      FROM aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) x
    ) normalized
  ) a
), ext_members AS (
  SELECT d.classid,d.objid,e.extname FROM pg_depend d JOIN pg_extension e
    ON d.refclassid='pg_extension'::regclass AND d.refobjid=e.oid
  WHERE d.deptype='e'
), members AS (
  SELECT format('%s|function|%I.%I(%s)',e.extname,n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) AS object_id,
    pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS security_definer
  FROM pg_proc p JOIN ns n ON n.oid=p.pronamespace
  JOIN ext_members e ON e.classid='pg_proc'::regclass AND e.objid=p.oid
  UNION ALL
  SELECT format('%s|relation|%I.%I',e.extname,n.nspname,r.relname),
    pg_get_userbyid(r.relowner),false
  FROM pg_class r JOIN ns n ON n.oid=r.relnamespace
  JOIN ext_members e ON e.classid='pg_class'::regclass AND e.objid=r.oid
  WHERE r.relkind IN ('r','p','v','m','S','f')
)
SELECT json_build_object(
  'schema_metadata',(SELECT jsonb_object_agg(object_id,value) FROM schemas),
  'extension_member_owners',(SELECT jsonb_object_agg(object_id,owner) FROM members),
  'extension_security_definers',(SELECT COALESCE(jsonb_agg(object_id ORDER BY object_id COLLATE "C")
    FILTER (WHERE security_definer),'[]'::jsonb) FROM members)
) AS access_details;
ROLLBACK;
