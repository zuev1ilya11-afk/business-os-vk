create index if not exists orders_reschedule_requested_by_idx
  on public.orders (reschedule_requested_by)
  where reschedule_requested_by is not null;
