-- Per-number master contact journal and latest contact state.
-- Existing master_called_* columns remain the immutable first successful-contact receipt.
alter table public.orders
  add column if not exists master_contact_history jsonb not null default '[]'::jsonb,
  add column if not exists master_contact_status text,
  add column if not exists master_contact_comment text,
  add column if not exists master_contact_phone text,
  add column if not exists master_contact_updated_at timestamptz,
  add column if not exists master_contact_callback_at timestamptz;

comment on column public.orders.master_contact_history is 'Last contact attempts/results for the assigned master, including exact dialed phone and server timestamps.';
comment on column public.orders.master_contact_status is 'Latest contact result: pending, no_answer, thinking, waiting_delivery, call_later, agreed, other.';
comment on column public.orders.master_contact_comment is 'Latest master contact note, max 500 chars enforced by master-workflow-api.';
comment on column public.orders.master_contact_phone is 'Normalized phone used for the latest contact attempt.';
comment on column public.orders.master_contact_updated_at is 'Server timestamp of the latest contact attempt/result.';
comment on column public.orders.master_contact_callback_at is 'Optional requested callback time for the latest contact result.';

alter table public.orders drop constraint if exists orders_master_contact_status_check;
alter table public.orders add constraint orders_master_contact_status_check
  check (master_contact_status is null or master_contact_status in ('pending','no_answer','thinking','waiting_delivery','call_later','agreed','other'));

create or replace function public.guard_master_contact_journal()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if current_user <> 'service_role' then
    if tg_op='INSERT' then
      if new.master_contact_history is distinct from '[]'::jsonb
         or new.master_contact_status is not null
         or new.master_contact_comment is not null
         or new.master_contact_phone is not null
         or new.master_contact_updated_at is not null
         or new.master_contact_callback_at is not null then
        raise exception 'MASTER_CONTACT_JOURNAL_SERVER_ONLY' using errcode='42501';
      end if;
    elsif new.master_contact_history is distinct from old.master_contact_history
       or new.master_contact_status is distinct from old.master_contact_status
       or new.master_contact_comment is distinct from old.master_contact_comment
       or new.master_contact_phone is distinct from old.master_contact_phone
       or new.master_contact_updated_at is distinct from old.master_contact_updated_at
       or new.master_contact_callback_at is distinct from old.master_contact_callback_at then
      raise exception 'MASTER_CONTACT_JOURNAL_SERVER_ONLY' using errcode='42501';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.guard_master_contact_journal() from public,anon,authenticated;
grant execute on function public.guard_master_contact_journal() to service_role;

drop trigger if exists zz_bos_guard_master_contact_journal on public.orders;
create trigger zz_bos_guard_master_contact_journal before insert or update on public.orders
for each row execute function public.guard_master_contact_journal();
