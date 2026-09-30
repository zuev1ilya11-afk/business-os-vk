begin;
do $$ begin
 if not exists(select from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create table public.orders(id bigint primary key,status text,external_source text,external_id text,
 report_review_status text,report_upload_token text,report_type text,report_act_url text,report_measurement_url text,
 report_photo_urls text,report_reviewed_at timestamptz,report_review_comment text,work text,
 extra_work_done boolean,extra_work_description text,extra_work_amount numeric,
 uncompleted_work_done boolean,uncompleted_work_description text,uncompleted_work_amount numeric,
 amount numeric default 1000,master_payout numeric default 552.5);
create schema vault;
create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text,name text);
create function vault.create_secret(secret text,name text) returns uuid language plpgsql as $$
declare result uuid:=gen_random_uuid(); begin insert into vault.decrypted_secrets values(result,secret,name);return result;end $$;
create schema net;
create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$ select 1::bigint $$;
create function pg_temp.assert(ok boolean,detail text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'Hands report contract failed: %',detail;end if;end $$;
insert into public.orders(id,status,external_source,external_id,report_review_status,report_upload_token,report_type,work)
 values(1,'Выполнена','hands','hands:123','approved','old','work','Old'),
 (2,'В работе','hands','hands:124','pending','new','work','Frozen work'),
 (3,'В работе','avito','avito:125','pending','other','work','Other');
