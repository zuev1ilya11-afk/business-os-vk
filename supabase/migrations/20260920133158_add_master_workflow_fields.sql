alter table public.orders
  add column if not exists master_workflow_stage text not null default 'assigned',
  add column if not exists master_departed_at timestamptz,
  add column if not exists master_arrived_at timestamptz,
  add column if not exists master_started_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_master_workflow_stage_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_master_workflow_stage_check
      check (master_workflow_stage in ('assigned','departed','arrived','started'));
  end if;
end $$;

comment on column public.orders.master_workflow_stage is
  'Field workflow stage for assigned master; completion remains represented by orders.status/completed_at.';
