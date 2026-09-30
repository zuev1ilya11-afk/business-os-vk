BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE TABLE public.avito_connections(id smallint primary key,is_active boolean,avito_user_id bigint);
INSERT INTO public.avito_connections VALUES(1,true,42);
CREATE TABLE public.orders(
 id bigint generated always as identity primary key,client text not null,phone text,address text not null,work text not null,city text not null,
 status text not null check(status in ('Новая','В работе','Выполнена')),source text,external_source text not null,external_id text,
 avito_chat_id text,avito_item_id text,avito_item_url text,comment text,amount numeric not null default 0,original_amount numeric not null default 0,
 master_payout numeric not null default 0,manager_payout numeric not null default 0,dispatcher_payout numeric not null default 0,
 master_staff_id uuid,master_id uuid,scheduled_date date,scheduled_time time,sync_status text,source_updated_at timestamptz
);
CREATE UNIQUE INDEX orders_external_source_id_uidx ON public.orders(external_source,external_id) WHERE external_id IS NOT NULL;
GRANT SELECT ON public.avito_connections TO service_role;
GRANT ALL ON public.orders TO service_role;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
CREATE SCHEMA net;
CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE FUNCTION pg_temp.assert(ok boolean,detail text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'Avito assistant contract failed: %',detail;END IF;END $$;
