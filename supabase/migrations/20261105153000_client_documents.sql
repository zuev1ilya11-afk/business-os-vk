begin;
-- Each published document version has an immutable content hash. Startup rejects
-- edited text under an already-used version; consent records retain their meaning.
create table if not exists public.client_document_versions(document text not null,version text not null,body_hash text not null,title text not null,registered_at timestamptz not null default now(),primary key(document,version));
create table if not exists public.client_link_audit(id uuid primary key,order_id bigint not null references public.orders(id),account_id uuid not null references public.client_accounts(id),staff_id uuid not null references public.business_staff(id),verification_note text not null,created_at timestamptz not null default now());
alter table public.client_document_versions enable row level security;
alter table public.client_link_audit enable row level security;
revoke all on public.client_document_versions,public.client_link_audit from public;
do $$ declare r text;begin foreach r in array array['anon','authenticated'] loop
 if exists(select 1 from pg_roles where rolname=r) then execute format('revoke all on public.client_document_versions,public.client_link_audit from %I',r);end if;
end loop;end $$;
insert into public.client_schema_version(version) values(2) on conflict do nothing;
commit;
