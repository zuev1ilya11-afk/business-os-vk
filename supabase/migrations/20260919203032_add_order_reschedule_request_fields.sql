alter table public.orders
  add column if not exists reschedule_requested boolean not null default false,
  add column if not exists reschedule_reason text,
  add column if not exists reschedule_requested_at timestamptz,
  add column if not exists reschedule_requested_by uuid references public.business_staff(id) on delete set null;

create index if not exists orders_reschedule_requested_idx
  on public.orders (reschedule_requested)
  where reschedule_requested = true;
