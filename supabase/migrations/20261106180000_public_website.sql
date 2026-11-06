-- Additive feature; apply only after explicit release approval. No price copies.
begin;
create table public.website_schema_version(version integer primary key, applied_at timestamptz not null default now());
create table public.website_service_pages(
 service_id text primary key references public.client_catalog(id), source_ref text not null,
 upper_source_ref text, approved_fingerprint text, public_title text not null, slug text unique not null,
 short_description text not null default '', full_description text not null default '',
 category text not null, category_slug text not null, subcategory text not null default '', subcategory_slug text not null default '',
 image text not null default '', duration text not null default '',
 price_display_mode text not null default 'after_inspection' check(price_display_mode in ('fixed','range','from','after_inspection')),
 included_text text not null default '', excluded_text text not null default '',
 seo_title text not null default '', seo_description text not null default '', synonyms text[] not null default '{}',
 published boolean not null default false, sort_order integer not null default 0,
 version integer not null default 1, updated_at timestamptz not null default now(),
 check(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'));
create table public.website_order_attribution(
 order_id bigint primary key references public.orders(id), utm jsonb not null default '{}',
 needs_clarification boolean not null default true, created_at timestamptz not null default now());
create table public.website_business_leads(
 id uuid primary key, account_id uuid not null references public.client_accounts(id),
 source text not null default 'website_business' check(source='website_business'),
 company text not null, contact_name text not null, phone text not null, email text not null default '',
 description text not null, objects_count integer not null check(objects_count between 1 and 10000),
 comment text not null default '', utm jsonb not null default '{}',
 status text not null default 'new' check(status in ('new','contacted','closed')),
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.website_staff_events(
 id bigint generated always as identity primary key, lead_id uuid references public.website_business_leads(id),
 kind text not null, staff_id uuid references public.business_staff(id),
 target_id text, details jsonb not null default '{}', created_at timestamptz not null default now());
create table public.website_reviews(
 order_id bigint primary key references public.orders(id), account_id uuid not null references public.client_accounts(id),
 rating integer not null check(rating between 1 and 5), body text not null,
 public_name text not null, publication_consent boolean not null default false, published boolean not null default false,
 reviewed_by uuid references public.business_staff(id), created_at timestamptz not null default now(),
 check(not published or (publication_consent and reviewed_by is not null)));
alter table public.client_public_masters add column if not exists public_phone text not null default '';
create index website_leads_queue on public.website_business_leads(status,created_at desc);
create index website_services_search on public.website_service_pages using gin(to_tsvector('russian',public_title || ' ' || short_description || ' ' || category));
do $$ declare t text; r text; begin
 for t in select tablename from pg_tables where schemaname='public' and tablename like 'website\_%' escape '\' loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public',t);
  foreach r in array array['anon','authenticated'] loop
   if exists(select 1 from pg_roles where rolname=r) then execute format('revoke all on public.%I from %I',t,r); end if;
  end loop;
 end loop;
end $$;
insert into public.website_schema_version(version) values(1);
commit;
