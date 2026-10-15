-- Extends push/control disposable schema, never production.
alter table public.orders add column phone text default '+79990000002',add column updated_at timestamptz,
 add column sync_status text,add column master_arrived_at timestamptz,add column report_act_url text;
create table public.staff_schedule(staff_id uuid,work_date date,is_working boolean,work_start time,work_end time,primary key(staff_id,work_date));
grant select on public.staff_schedule to service_role;
grant insert on public.orders to service_role;
