-- Additive client boundary. Run only after checking deployed orders schema.
-- No auth.users integration; no staff accounts are created on client signup.
begin;
create table public.client_schema_version(version integer primary key, applied_at timestamptz not null default now());
create table public.client_accounts(
 id uuid primary key, phone text unique not null check(phone ~ '^\+7[0-9]{10}$'), name text not null default '',
 email text not null default '', notification_preferences jsonb not null default '{"in_app":true,"push":false}',
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
alter table public.orders add column if not exists client_account_id uuid references public.client_accounts(id),
 add column if not exists client_portal_revision integer not null default 1;
create index orders_client_account_page on public.orders(client_account_id,created_at desc,id desc) where client_account_id is not null;
create table public.client_sessions(token_hash text primary key,account_id uuid not null references public.client_accounts(id),
 csrf_hash text not null, csrf_token text not null, created_at timestamptz not null default now(), expires_at timestamptz not null, revoked_at timestamptz);
create index client_sessions_account on public.client_sessions(account_id);
create table public.client_otps(id uuid primary key,phone text not null,code_hash text not null,purpose text not null check(purpose in ('login','change_phone')),
 account_id uuid references public.client_accounts(id),created_at timestamptz not null default now(),expires_at timestamptz not null,used_at timestamptz,attempts integer not null default 0);
create index client_otps_phone_recent on public.client_otps(phone,created_at desc);
create table public.client_rate_limits(key text primary key,hits integer not null,expires_at timestamptz not null);
create table public.client_addresses(id uuid primary key,account_id uuid not null references public.client_accounts(id),label text not null,address text not null,entrance text not null default '',floor text not null default '',intercom text not null default '',version integer not null default 1);
create index client_addresses_account on public.client_addresses(account_id);
create table public.client_catalog(id text primary key,category text not null,name text not null,description text not null default '',unit text not null,
 price_type text not null check(price_type in ('fixed','from','unit','clarify')),price numeric(12,2),conditions text not null default '',city text not null,
 published boolean not null default false,confirmed boolean not null default false,available boolean not null default true,version integer not null default 1,updated_at timestamptz not null default now(),
 check((price_type='clarify' and price is null) or (price_type<>'clarify' and price>=0 and price<=1000000000)),check(not published or price_type='clarify' or confirmed));
create table public.client_order_quotes(order_id bigint primary key references public.orders(id),snapshot jsonb not null,desired_date text not null default '',desired_interval text not null default '',parameters jsonb not null default '{}');
create table public.client_estimates(order_id bigint not null references public.orders(id),version integer not null,items jsonb not null,total numeric(12,2) not null check(total>=0),conditions text not null default '',created_at timestamptz not null default now(),accepted_at timestamptz,primary key(order_id,version));
create table public.client_messages(id bigint generated always as identity primary key,account_id uuid not null references public.client_accounts(id),order_id bigint references public.orders(id),body text not null,sender text not null check(sender in ('client','company')),staff_id uuid references public.business_staff(id),created_at timestamptz not null default now(),read_at timestamptz);
create index client_messages_thread on public.client_messages(account_id,order_id,id);
create index client_messages_unread on public.client_messages(account_id,sender) where read_at is null;
create table public.client_requests(id uuid primary key,account_id uuid not null references public.client_accounts(id),order_id bigint references public.orders(id),type text not null check(type in ('reschedule','cancel','warranty','privacy_access','privacy_delete','privacy_correction')),text text not null,desired_date text not null default '',desired_interval text not null default '',status text not null default 'pending' check(status in ('pending','accepted','declined')),response text not null default '',version integer not null default 1,created_at timestamptz not null default now(),resolved_at timestamptz,resolved_by uuid references public.business_staff(id));
create index client_requests_pending on public.client_requests(status,created_at);
create table public.client_attachments(id uuid primary key,account_id uuid not null references public.client_accounts(id),order_id bigint not null references public.orders(id),name text not null,mime text not null check(mime in ('image/jpeg','image/png','image/webp')),size integer not null check(size>0 and size<=10485760),storage_key text not null unique,sha256 text not null,created_at timestamptz not null default now());
create index client_attachments_order on public.client_attachments(order_id);
create table public.client_events(id bigint generated always as identity primary key,order_id bigint not null references public.orders(id),type text not null,text text not null,created_at timestamptz not null default now());
create index client_events_order on public.client_events(order_id,id);
create table public.client_consents(account_id uuid not null references public.client_accounts(id),document text not null,version text not null,accepted_at timestamptz not null default now(),primary key(account_id,document,version));
create table public.client_public_masters(staff_id uuid primary key references public.business_staff(id),name text not null,specialization text not null default '',photo_url text not null default '');
create table public.client_notifications(id bigint generated always as identity primary key,event_id bigint unique references public.client_events(id),account_id uuid not null references public.client_accounts(id),kind text not null,status text not null default 'pending' check(status in ('pending','suppressed','sent','failed')),attempts integer not null default 0,next_attempt_at timestamptz not null default now(),last_error text);
create table public.client_link_audit(id uuid primary key,order_id bigint not null references public.orders(id),account_id uuid not null references public.client_accounts(id),staff_id uuid not null references public.business_staff(id),verification_note text not null,created_at timestamptz not null default now());
create table public.client_idempotency(account_id uuid not null references public.client_accounts(id),scope text not null,request_id text not null,payload_hash text not null,response jsonb not null,created_at timestamptz not null default now(),primary key(account_id,scope,request_id));
-- The API connection is a dedicated trusted service identity, never anon/authenticated.
-- All browser access is through ownership-checking API projections, not PostgREST.
do $$ declare t text; r text; begin
 for t in select tablename from pg_tables where schemaname='public' and tablename like 'client\_%' escape '\' loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public',t);
  foreach r in array array['anon','authenticated'] loop
   if exists(select 1 from pg_roles where rolname=r) then execute format('revoke all on public.%I from %I',t,r); end if;
  end loop;
 end loop;
end $$;
create function public.bos_client_order_event() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare e bigint; kind text; label text;
begin
 if new.client_account_id is null then return new; end if;
 if TG_OP='INSERT' then kind:='created'; label:='Заявка принята компанией';
 elsif old.client_account_id is distinct from new.client_account_id then kind:='linked'; label:='Заявка подключена к вашему кабинету';
 elsif old.status is distinct from new.status then
  kind:='status'; label:=case new.status::text when 'Выполнена' then 'Работы выполнены' when 'Отменена' then 'Заявка отменена' else 'Компания обновила заявку' end;
 elsif old.master_staff_id is distinct from new.master_staff_id then kind:='master'; label:='Назначение мастера обновлено';
 elsif old.master_agreed_at is distinct from new.master_agreed_at or old.scheduled_date is distinct from new.scheduled_date or old.scheduled_time is distinct from new.scheduled_time then
  kind:='visit'; label:=case when new.master_agreed_at is not null then 'Время визита согласовано' else 'Время визита уточняется' end;
 else return new; end if;
 insert into client_events(order_id,type,text) values(new.id,kind,label) returning id into e;
 insert into client_notifications(event_id,account_id,kind) values(e,new.client_account_id,kind) on conflict(event_id) do nothing;
 return new;
end $$;
revoke all on function public.bos_client_order_event() from public;
create trigger bos_client_order_event after insert or update on public.orders for each row execute function public.bos_client_order_event();
create function public.bos_client_order_revision() returns trigger language plpgsql as $$
begin
 if new.client_account_id is not null and row(new.status,new.master_staff_id,new.scheduled_date,new.scheduled_time,new.master_agreed_at,new.amount,new.work_items,new.address,new.time_slot,new.work,new.entrance,new.floor,new.intercom,new.client_account_id,new.original_amount,new.amount_confirmed) is distinct from row(old.status,old.master_staff_id,old.scheduled_date,old.scheduled_time,old.master_agreed_at,old.amount,old.work_items,old.address,old.time_slot,old.work,old.entrance,old.floor,old.intercom,old.client_account_id,old.original_amount,old.amount_confirmed) then new.client_portal_revision:=old.client_portal_revision+1; end if;
 return new;
end $$;
revoke all on function public.bos_client_order_revision() from public;
create trigger bos_client_order_revision before update on public.orders for each row execute function public.bos_client_order_revision();
insert into public.client_schema_version(version) values(1);
commit;
