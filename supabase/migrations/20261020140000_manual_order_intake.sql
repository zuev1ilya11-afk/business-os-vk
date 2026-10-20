-- Additive: old orders and integration identifiers are left untouched.
begin;
alter table public.orders
  add column if not exists order_number text,
  add column if not exists received_date date,
  add column if not exists entrance text,
  add column if not exists floor text,
  add column if not exists intercom text,
  add column if not exists amount_confirmed boolean;
alter table public.orders add constraint orders_manual_number_valid check
  (order_number is null or (order_number=btrim(order_number) and char_length(order_number) between 1 and 80 and order_number !~ '[[:cntrl:]]'));
create or replace function public.bos_order_number_source(value text) returns text
language sql immutable parallel safe set search_path=public as $$
 select case lower(btrim(coalesce(value,''))) when 'руки' then 'hands' when 'авито' then 'avito' else lower(btrim(coalesce(value,''))) end
$$;
create unique index orders_manual_number_unique on public.orders
  (public.bos_order_number_source(source),order_number) where order_number is not null;
-- Also protect against a manually entered number duplicating an existing auto/Hands display number.
create or replace function public.bos_check_manual_order_number() returns trigger
language plpgsql set search_path=public as $$
begin
 if new.order_number is null then return new; end if;
 perform pg_advisory_xact_lock(hashtext(public.bos_order_number_source(new.source)),hashtext(new.order_number));
 if exists(select 1 from public.orders o where o.id is distinct from new.id
   and public.bos_order_number_source(o.source)=public.bos_order_number_source(new.source)
   and coalesce(o.order_number,case when o.external_id like 'hands:%' then substring(o.external_id from 7) else o.id::text end)=new.order_number)
 then raise exception 'orders_manual_number_unique' using errcode='23505'; end if;
 return new;
end $$;
create trigger orders_check_manual_number before insert or update of order_number,source on public.orders
  for each row execute function public.bos_check_manual_order_number();
-- Existing APIs may later set a real price without knowing the UI marker.
-- Only the marker changes; monetary values and payout rules are untouched.
create or replace function public.bos_confirm_order_amount_on_change() returns trigger
language plpgsql set search_path=public as $$
begin
 if new.amount_confirmed=false and (coalesce(new.amount,0)<>0 or coalesce(new.original_amount,0)<>0)
   and (new.amount is distinct from old.amount or new.original_amount is distinct from old.original_amount)
 then new.amount_confirmed=true; end if;
 return new;
end $$;
create trigger zz_bos_confirm_order_amount before update on public.orders
 for each row execute function public.bos_confirm_order_amount_on_change();
comment on column public.orders.order_number is 'Optional business display number; never an integration or primary identifier. Unique within canonical source.';
comment on column public.orders.received_date is 'Company receipt calendar date, independent of visit date and created_at.';
comment on column public.orders.amount_confirmed is 'False when the new manual form omitted cost; numeric bookkeeping and payroll rules remain unchanged. Null preserves legacy semantics.';
commit;
