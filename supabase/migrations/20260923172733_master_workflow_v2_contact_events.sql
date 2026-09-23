alter table public.orders
  add column if not exists master_called_at timestamptz,
  add column if not exists master_agreed_at timestamptz;

comment on column public.orders.master_called_at is 'When the assigned master confirmed that the client call was completed.';
comment on column public.orders.master_agreed_at is 'When the assigned master confirmed the visit agreement with the client.';
