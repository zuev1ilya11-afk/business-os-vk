-- Business OS secure Supabase schema
-- VK ID authentication edition
-- RESET ONLY Business OS public tables. auth.users is preserved.

create extension if not exists pgcrypto;

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.master_set_order_status(bigint, public.order_status) cascade;
drop function if exists public.current_role() cascade;
drop function if exists public.touch_updated_at() cascade;

drop table if exists public.orders cascade;
drop table if exists public.profiles cascade;
drop type if exists public.order_status cascade;
drop type if exists public.user_role cascade;

create type public.user_role as enum ('owner','manager','dispatcher','master');
create type public.order_status as enum ('Новая','Назначена','В работе','Выполнена','Отменена');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  vk_user_id bigint unique,
  full_name text not null default 'Сотрудник',
  role public.user_role not null default 'master',
  city text not null default 'Москва',
  avatar_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index profiles_vk_user_id_idx on public.profiles(vk_user_id);

create table public.orders (
  id bigint generated always as identity primary key,
  client text not null,
  phone text,
  address text not null,
  work text not null,
  master_id uuid references public.profiles(id),
  status public.order_status not null default 'Новая',
  amount numeric(12,2) not null default 0,
  scheduled_date date,
  scheduled_time time,
  source text,
  comment text,
  city text not null default 'Москва',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1), 'Сотрудник'))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles(id, full_name)
select u.id, coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email,'@',1), 'Сотрудник')
from auth.users u
on conflict (id) do nothing;

create or replace function public.current_role()
returns public.user_role language sql stable security definer set search_path=public as $$
  select role from public.profiles where id=auth.uid() and is_active=true
$$;

alter table public.profiles enable row level security;
alter table public.orders enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
using (is_active = true or id = auth.uid());

drop policy if exists profiles_owner_update on public.profiles;
create policy profiles_owner_update on public.profiles for update to authenticated
using (public.current_role()='owner') with check (public.current_role()='owner');

drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders for select to authenticated using (
  public.current_role()='owner'
  or (public.current_role() in ('manager','dispatcher') and city=(select city from public.profiles where id=auth.uid()))
  or (public.current_role()='master' and master_id=auth.uid())
);

drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders for insert to authenticated with check (
  public.current_role() in ('owner','manager','dispatcher')
  and created_by=auth.uid()
  and (public.current_role()='owner' or city=(select city from public.profiles where id=auth.uid()))
);

drop policy if exists orders_update_staff on public.orders;
create policy orders_update_staff on public.orders for update to authenticated using (
  public.current_role()='owner'
  or (public.current_role() in ('manager','dispatcher') and city=(select city from public.profiles where id=auth.uid()))
) with check (
  public.current_role()='owner'
  or (public.current_role() in ('manager','dispatcher') and city=(select city from public.profiles where id=auth.uid()))
);

create or replace function public.master_set_order_status(p_order_id bigint, p_status public.order_status)
returns void language plpgsql security definer set search_path=public as $$
begin
  if public.current_role() <> 'master' then raise exception 'master only'; end if;
  if p_status not in ('В работе','Выполнена') then raise exception 'status not allowed'; end if;
  update public.orders set status=p_status, updated_at=now()
  where id=p_order_id and master_id=auth.uid();
end $$;
revoke all on function public.master_set_order_status(bigint,public.order_status) from public;
grant execute on function public.master_set_order_status(bigint,public.order_status) to authenticated;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
create trigger trg_orders_updated_at before update on public.orders
for each row execute function public.touch_updated_at();

grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant select,insert,update on public.orders to authenticated;
grant usage,select on sequence public.orders_id_seq to authenticated;

-- After your first successful VK login, promote your VK account once:
-- update public.profiles set role='owner', full_name='Илья'
-- where vk_user_id=YOUR_VK_USER_ID;
