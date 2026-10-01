-- Independent transaction supplied by push-schema.sql; no production data or network.
insert into public.orders(id,status,master_staff_id,report_review_status) values
 (81,'В работе','00000000-0000-4000-8000-000000000003','rejected'),(82,'В работе',null,'rejected'),(83,'В работе',null,null);
create function pg_temp.cinput(oid text,code text,aid uuid,ver integer default 0) returns jsonb language sql as $$
 select jsonb_build_object('order_id',oid,'issue_code',code,'assignee_id',aid,'expected_version',ver,'remind',true,
 'due_at',to_char((now() at time zone 'UTC')+interval '1 hour','YYYY-MM-DD"T"HH24:MI:SS')||'Z');
$$;
select pg_temp.check_contract((public.bos_control_action('00000000-0000-4000-8000-000000000001','controlSave',pg_temp.cinput('82','report_rejected','00000000-0000-4000-8000-000000000003'))->>'status')::int=400,'null order master cannot authorize unrelated master');
select pg_temp.check_contract((public.bos_control_action('00000000-0000-4000-8000-000000000001','controlSave',pg_temp.cinput('81','report_rejected','00000000-0000-4000-8000-000000000003'))->>'ok')::boolean,'current master correction is assignable');
select pg_temp.check_contract(jsonb_array_length(public.bos_control_action('00000000-0000-4000-8000-000000000003','controlList')->'tasks')=1,'master sees own current correction');
select pg_temp.check_contract(jsonb_array_length(public.bos_control_action('00000000-0000-4000-8000-000000000004','controlList','{"order_id":"81","issue_code":"report_rejected"}')->'tasks')=0,'other master cannot fetch exact task');
update public.orders set master_staff_id='00000000-0000-4000-8000-000000000004' where id=81;
select pg_temp.check_contract(jsonb_array_length(public.bos_control_action('00000000-0000-4000-8000-000000000003','controlList','{"order_id":"81","issue_code":"report_rejected"}')->'tasks')=0,'removed master cannot fetch historical assignment by exact key');
update public.business_staff set role=null where id='00000000-0000-4000-8000-000000000004';
select pg_temp.check_contract((public.bos_control_action('00000000-0000-4000-8000-000000000004','controlList')->>'status')::int=403,'null role fails closed');
select pg_temp.check_contract((public.bos_control_action('00000000-0000-4000-8000-000000000001','controlSave',pg_temp.cinput('81','report_rejected','00000000-0000-4000-8000-000000000004',2))->>'status')::int=400,'null assignee role fails closed');
update public.business_staff set role='master' where id='00000000-0000-4000-8000-000000000004';
select pg_temp.check_contract((public.bos_control_action('00000000-0000-4000-8000-000000000001','controlSave',pg_temp.cinput('83','unassigned','00000000-0000-4000-8000-000000000002'))->>'ok')::boolean,'dispatcher task saved');
update bos_control_private.runtime set enabled=true;update bos_push_private.runtime set enabled=true;
update bos_control_private.tasks set due_at=now()-interval '1 minute' where order_id=83;
select bos_control_private.tick();
select pg_temp.check_contract((select count(*)=0 from public.bos_push_deliveries),'no subscription does not invent a send');
insert into public.bos_push_subscriptions(staff_id,external_id,endpoint,p256dh,auth_key,revoke_hash)
values('00000000-0000-4000-8000-000000000002','staff_dispatcher','https://fcm.googleapis.com/fcm/send/control-isolation','key','auth',repeat('b',64));
select bos_control_private.tick();
create temporary table lease as select public.bos_push_claim() as rows;
select pg_temp.check_contract((select jsonb_array_length(rows)=1 from lease),'one initial lease');
update public.bos_push_deliveries set locked_until=now()-interval '1 minute' where event_type='control_due';
select pg_temp.check_contract(jsonb_array_length(public.bos_push_claim())=0,'abandoned sender lease is not retried');
select pg_temp.check_contract((select state='discarded' from public.bos_push_deliveries where event_type='control_due'),'abandoned lease is unconfirmed');
select pg_temp.check_contract((public.bos_control_action('00000000-0000-4000-8000-000000000001','controlSave',pg_temp.cinput('83','unassigned','00000000-0000-4000-8000-000000000002',1))->>'ok')::boolean,'explicit reschedule after abandoned lease');
update bos_control_private.tasks set due_at=now()-interval '1 minute' where order_id=83;
select bos_control_private.tick();truncate lease;insert into lease select public.bos_push_claim();
select pg_temp.check_contract((select jsonb_array_length(rows)=1 from lease),'new explicit schedule gets one new lease');
select pg_temp.check_contract((public.bos_control_action('00000000-0000-4000-8000-000000000001','controlSave',pg_temp.cinput('83','unassigned','00000000-0000-4000-8000-000000000001',2))->>'ok')::boolean,'reassign current task to owner');
select pg_temp.check_contract((select public.bos_push_delivery((rows->0->>'id')::uuid,(rows->0->>'lease_token')::uuid) is null from lease),'old assignee cannot receive queued reminder');
select pg_temp.check_contract(jsonb_array_length(public.bos_push_claim())=0,'reassignment does not instantly queue future deadline');
select pg_temp.check_contract((public.bos_control_action('00000000-0000-4000-8000-000000000001','controlClear','{"order_id":"83","issue_code":"unassigned","expected_version":3}')->>'ok')::boolean,'explicit clear succeeds');
select pg_temp.check_contract(jsonb_array_length(public.bos_control_action('00000000-0000-4000-8000-000000000001','controlList')->'tasks')=0,'clear and reassignment leave no active tasks');
ROLLBACK;
