-- Business OS secure Supabase schema
create extension if not exists pgcrypto;

do $$ begin
  create type public.user_role as enum ('owner','manager','dispatcher','master');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_status as enum ('Новая','Назначена','В работе','Выполнена','Отменена');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'Сотрудник',
  role public.user_role not null default 'master',
  city text not null default 'Москва',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
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
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.current_role()
returns public.user_role language sql stable security definer set search_path=public as $$
  select role from public.profiles where id=auth.uid() and is_active=true
$$;

alter table public.profiles enable row level security;
alter table public.orders enable row level security;

-- Profiles: authenticated staff can see active team; only owner manages roles.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
using (is_active = true or id = auth.uid());

drop policy if exists profiles_owner_update on public.profiles;
create policy profiles_owner_update on public.profiles for update to authenticated
using (public.current_role()='owner') with check (public.current_role()='owner');

-- Orders: owner/manager/dispatcher see their city; master sees only assigned orders.
drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders for select to authenticated using (
  public.current_role()='owner'
  or (public.current_role() in ('manager','dispatcher') and city=(select city from public.profiles where id=auth.uid()))
  or (public.current_role()='master' and master_id=auth.uid())
);

drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders for insert to authenticated with check (
  public.current_role() in ('owner','manager','dispatcher')
);

drop policy if exists orders_update_staff on public.orders;
create policy orders_update_staff on public.orders for update to authenticated using (
  public.current_role()='owner'
  or (public.current_role() in ('manager','dispatcher') and city=(select city from public.profiles where id=auth.uid()))
) with check (
  public.current_role()='owner'
  or (public.current_role() in ('manager','dispatcher') and city=(select city from public.profiles where id=auth.uid()))
);

-- Masters may only change status through this RPC.
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
drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at before update on public.orders for each row execute function public.touch_updated_at();

grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant select,insert,update on public.orders to authenticated;
grant usage,select on sequence public.orders_id_seq to authenticated;

-- After your FIRST signup, promote yourself once in SQL Editor by replacing the email:
-- update public.profiles p set role='owner', full_name='Илья'
-- from auth.users u where p.id=u.id and u.email='YOUR_EMAIL';
