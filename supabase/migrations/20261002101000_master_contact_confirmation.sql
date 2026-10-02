-- Extend the existing call event; never backfill historical calls as confirmed.
-- No policy, workflow, payroll or report state changes.
alter table public.orders
  add column if not exists master_called_by_staff_id uuid,
  add column if not exists master_called_by_name text;

comment on column public.orders.master_called_by_staff_id is 'Immutable authenticated master identity at first explicit successful-contact confirmation; intentionally not a foreign key, to retain attribution after staff deletion.';
comment on column public.orders.master_called_by_name is 'Immutable staff name snapshot at first explicit successful-contact confirmation. Null on unverified legacy call marks.';
comment on column public.orders.master_called_at is 'First explicit successful-contact time when author provenance is present; otherwise an unverified legacy call mark.';

create or replace function public.guard_master_contact_confirmation()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare author_name text;
begin
  if tg_op='UPDATE' then
    if old.master_called_at is not null and old.master_called_by_staff_id is not null and nullif(btrim(old.master_called_by_name),'') is not null then
      -- Runs after the existing restart/report guard: keep the original receipt,
      -- including during reassignment, report correction and Hands imports.
      new.master_called_at:=old.master_called_at;
      new.master_called_by_staff_id:=old.master_called_by_staff_id;
      new.master_called_by_name:=old.master_called_by_name;
      return new;
    end if;
  end if;
  if new.master_called_by_staff_id is null and new.master_called_by_name is null then return new; end if;
  if tg_op<>'UPDATE' or current_user<>'service_role' then
    raise exception 'MASTER_CONTACT_SERVER_ONLY' using errcode='42501';
  end if;
  if new.master_called_by_staff_id is null or new.master_called_by_staff_id is distinct from old.master_staff_id
     or new.master_staff_id is distinct from old.master_staff_id
     or old.status::text in ('Выполнена','Отменена') or new.status::text in ('Выполнена','Отменена') then
    raise exception 'MASTER_CONTACT_ASSIGNMENT_REQUIRED' using errcode='42501';
  end if;
  select coalesce(nullif(btrim(full_name),''),'Мастер') into author_name from public.business_staff
    where id=new.master_called_by_staff_id and role::text='master' and is_active=true;
  if not found then raise exception 'MASTER_CONTACT_ACTIVE_MASTER_REQUIRED' using errcode='42501'; end if;
  -- Database clock and current staff record are authoritative; ignore inputs.
  new.master_called_at:=clock_timestamp();
  new.master_called_by_name:=author_name;
  return new;
end $$;
revoke all on function public.guard_master_contact_confirmation() from public,anon,authenticated;
grant execute on function public.guard_master_contact_confirmation() to service_role;
drop trigger if exists zz_bos_guard_master_contact on public.orders;
create trigger zz_bos_guard_master_contact before insert or update on public.orders
for each row execute function public.guard_master_contact_confirmation();
