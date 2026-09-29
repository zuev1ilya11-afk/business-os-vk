-- Disposable PostgreSQL contract schema; Vault encryption and HTTP are controlled boundaries.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE TABLE public.business_staff(id uuid PRIMARY KEY,external_id text UNIQUE,role text,is_active boolean);
CREATE TABLE public.orders(id bigint PRIMARY KEY,master_staff_id uuid REFERENCES public.business_staff(id),status text,scheduled_date date,scheduled_time time,time_slot text,report_review_status text,report_uploaded_at timestamptz);
GRANT SELECT,UPDATE ON public.business_staff TO service_role;
GRANT SELECT ON public.orders TO service_role;
CREATE SCHEMA vault;
CREATE TABLE vault.decrypted_secrets(id uuid PRIMARY KEY, decrypted_secret text, name text);
CREATE FUNCTION vault.create_secret(secret text,name text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE result uuid:=gen_random_uuid(); BEGIN INSERT INTO vault.decrypted_secrets VALUES(result,secret,name);RETURN result;END $$;
CREATE SCHEMA net;
CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE FUNCTION pg_temp.check_contract(ok boolean,detail text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'Push contract failed: %',detail;END IF;END $$;
INSERT INTO public.business_staff VALUES
 ('00000000-0000-4000-8000-000000000001','100','owner',true),
 ('00000000-0000-4000-8000-000000000002','staff_dispatcher','dispatcher',true),
 ('00000000-0000-4000-8000-000000000003','staff_master1','master',true),
 ('00000000-0000-4000-8000-000000000004','staff_master2','master',true),
 ('00000000-0000-4000-8000-000000000005','staff_disabled','master',false);
