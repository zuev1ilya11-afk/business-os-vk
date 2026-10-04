BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE TABLE public.orders(id bigint PRIMARY KEY,amount numeric,master_payout numeric);
CREATE TABLE public.business_staff(id uuid PRIMARY KEY);
INSERT INTO public.business_staff VALUES ('00000000-0000-4000-8000-000000000001');
INSERT INTO public.orders VALUES (1,1000,600);
