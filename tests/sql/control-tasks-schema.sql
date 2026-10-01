alter table public.business_staff add column full_name text;
update public.business_staff set full_name=external_id;
alter table public.orders add column master_name text,add column master_agreed_at timestamptz,add column master_called_at timestamptz,
 add column master_workflow_stage text,add column master_started_at timestamptz,add column master_departed_at timestamptz,
 add column reschedule_requested boolean,add column uncompleted_work_amount numeric,add column amount numeric,add column master_payout numeric;
