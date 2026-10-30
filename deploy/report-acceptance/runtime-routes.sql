-- Explicit operational repair after inspecting actual runtime URLs. Preserves enabled flags and secrets.
-- psql --set=bos_functions_url=<verified internal gateway>/functions/v1 --single-transaction -f this-file
-- Do not run against production before a backup and release approval.
select set_config('bos.release.functions_url', :'bos_functions_url', true);
do $$
declare base text:=current_setting('bos.release.functions_url'); target text; item record;
begin
 if base !~ '^https?://[A-Za-z0-9._:-]+/functions/v1$' then raise exception 'INVALID_INTERNAL_FUNCTIONS_URL'; end if;
 for item in select * from (values
  ('bos_push_private','push-api'),('bos_hands_private','hands-report-api'),('bos_avito_private','avito-assistant-api')
 ) as x(schema_name,slug) loop
  if to_regclass(format('%I.runtime',item.schema_name)) is not null then
   target:=base||'/'||item.slug;
   execute format('update %I.runtime set worker_url=$1 where singleton',item.schema_name) using target;
  end if;
 end loop;
end $$;
