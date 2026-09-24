-- Internal tables are accessed by service_role Edge Functions.
-- Keep RLS deny-by-default and all existing server privileges.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['business_staff','staff_schedule','order_claims','api_integrations'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.' || t) AND relrowsecurity)
       OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t) THEN
      RAISE EXCEPTION 'Unexpected RLS/policy state for public.%', t;
    END IF;
  END LOOP;
END $$;

REVOKE ALL PRIVILEGES ON TABLE
  public.business_staff,
  public.staff_schedule,
  public.order_claims,
  public.api_integrations
FROM PUBLIC, anon, authenticated;

-- Read-only effective privilege checks; raises on regression, exposes no rows.
DO $$
DECLARE t text; r text; p text;
BEGIN
  FOREACH t IN ARRAY ARRAY['business_staff','staff_schedule','order_claims','api_integrations'] LOOP
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF has_table_privilege(r, 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         OR has_any_column_privilege(r, 'public.' || t, 'SELECT,INSERT,UPDATE,REFERENCES') THEN
        RAISE EXCEPTION 'Unexpected client privilege: % on %', r, t;
      END IF;
    END LOOP;
    FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
      IF NOT has_table_privilege('service_role', 'public.' || t, p) THEN
        RAISE EXCEPTION 'Missing service_role % on %', p, t;
      END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=to_regclass('public.' || t) AND relrowsecurity)
       OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t) THEN
      RAISE EXCEPTION 'RLS state changed for %', t;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role' AND rolbypassrls) THEN
    RAISE EXCEPTION 'service_role must retain BYPASSRLS';
  END IF;
END $$;
SELECT 'internal grants checks passed' AS result;
