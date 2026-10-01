-- Report snapshots only. NULL preserves the meaning of historical reports with no detail.
alter table public.orders add column if not exists uncompleted_work_items jsonb;
alter table public.orders add constraint orders_uncompleted_work_items_array
  check (uncompleted_work_items is null or jsonb_typeof(uncompleted_work_items) = 'array');
comment on column public.orders.uncompleted_work_items is
  'Server-validated unperformed work snapshot: catalogue identity, name, unit, quantity, applied price, line amount and price agreement. No historical backfill.';
