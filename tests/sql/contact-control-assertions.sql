-- Functional PostgreSQL assertions; all data is disposable and rolled back.
select pg_temp.check_contract(to_regprocedure('public.bos_contact_action(uuid,text,jsonb)') is not null,'atomic contact RPC exists');
select pg_temp.check_contract(not (select enabled from bos_control_private.contact_config),'default off');
insert into public.orders(id,master_staff_id,status,scheduled_date,scheduled_time,time_slot) values
 (701,'00000000-0000-4000-8000-000000000003','В работе',null,null,'10:00–12:30'),
 (702,'00000000-0000-4000-8000-000000000004','В работе',null,null,null);
update bos_control_private.contact_config set company_start='08:00',company_end='22:00',company_days=array[1,2,3,4,5],
 manager_id='00000000-0000-4000-8000-000000000001',pilot_staff_ids=array['00000000-0000-4000-8000-000000000003'::uuid,'00000000-0000-4000-8000-000000000004'::uuid],enabled=true;
select pg_temp.check_contract(not exists(select 1 from bos_control_private.tasks where contact_revision is not null),'activation does not backfill');
select pg_temp.check_contract(bos_control_private.contact_due('00000000-0000-4000-8000-000000000003','2026-10-16 21:30+03',60)='2026-10-19 08:30+03','Friday boundary uses working minutes');
insert into public.staff_schedule values('00000000-0000-4000-8000-000000000003','2026-10-19',false,null,null);
select pg_temp.check_contract(bos_control_private.contact_due('00000000-0000-4000-8000-000000000003','2026-10-16 21:30+03',60)='2026-10-20 08:30+03','master day off overrides company');
set local role service_role;
select pg_temp.check_contract((public.bos_contact_action('00000000-0000-4000-8000-000000000004','recordContactResult','{"id":701}') ->>'status')::int=403,'other master denied');
select pg_temp.check_contract((public.bos_contact_action('00000000-0000-4000-8000-000000000003','recordContactResult','{"id":701,"attempt_id":"missing_due_01","result":"no_answer","phone":"+79990000002","expected_revision":0}') ->>'status')::int=400,'no answer requires next action');
select pg_temp.check_contract((public.bos_contact_action('00000000-0000-4000-8000-000000000003','recordContactResult','{"id":701,"attempt_id":"missing_visit_01","result":"agreed","phone":"+79990000002","expected_revision":0}') ->>'status')::int=400,'agreed requires visit');
select pg_temp.check_contract((public.bos_contact_action('00000000-0000-4000-8000-000000000003','recordContactResult',jsonb_build_object('id',701,'attempt_id','outcome_no_answer','result','no_answer','phone','+79990000002','expected_revision',0,'callback_at',now()+interval '1 hour')) ->>'ok')::boolean,'save no answer');
select pg_temp.check_contract((select master_called_at is null and master_contact_revision=1 and scheduled_date is null from public.orders where id=701),'attempt is not success or fictitious visit');
select pg_temp.check_contract((select count(*)=1 from bos_control_private.tasks where order_id=701 and resolved_at is null),'one atomic obligation');
select pg_temp.check_contract((public.bos_contact_action('00000000-0000-4000-8000-000000000003','recordContactResult',jsonb_build_object('id',701,'attempt_id','outcome_no_answer','result','no_answer','phone','+79990000002','expected_revision',0,'callback_at',now()+interval '1 hour')) ->>'idempotent')::boolean,'retry exact receipt');
select pg_temp.check_contract((select jsonb_array_length(master_contact_history)=1 from public.orders where id=701),'retry no duplicate');
select pg_temp.check_contract((public.bos_contact_action('00000000-0000-4000-8000-000000000003','recordContactResult',jsonb_build_object('id',701,'attempt_id','stale_outcome_01','result','thinking','phone','+79990000002','expected_revision',0,'callback_at',now()+interval '2 hour')) ->>'status')::int=409,'stale form rejected');
select pg_temp.check_contract((public.bos_contact_action('00000000-0000-4000-8000-000000000003','recordContactResult',jsonb_build_object('id',701,'attempt_id','outcome_agreed_01','result','agreed','phone','+79990000002','expected_revision',1,'scheduled_date',(now() at time zone 'Europe/Moscow')::date+1,'scheduled_time','14:00')) ->>'ok')::boolean,'atomic agreed visit');
select pg_temp.check_contract((select master_called_at is not null and master_agreed_at is not null and scheduled_time='14:00' and time_slot='14:00–16:30' from public.orders where id=701),'agreement preserves duration');
select pg_temp.check_contract(not exists(select 1 from bos_control_private.tasks where order_id=701 and resolved_at is null),'agreement resolves contact obligation');
-- Staff shifts override company fallback, including outside company hours.
reset role;
insert into public.staff_schedule values('00000000-0000-4000-8000-000000000003','2026-10-18',true,'07:00','10:00');
select pg_temp.check_contract(bos_control_private.contact_due('00000000-0000-4000-8000-000000000003','2026-10-18 07:00+03',60)='2026-10-18 08:00+03','explicit staff shift overrides company fallback');
set local role service_role;
-- Both help outcomes require reasons and keep lifecycle/assignee untouched.
select pg_temp.check_contract((public.bos_contact_action('00000000-0000-4000-8000-000000000003','recordContactResult','{"id":701,"attempt_id":"help_no_reason1","result":"needs_help","phone":"+79990000002","expected_revision":2}') ->>'status')::int=400,'help requires reason');
select pg_temp.check_contract((public.bos_contact_action('00000000-0000-4000-8000-000000000003','recordContactResult','{"id":701,"attempt_id":"help_reason_001","result":"needs_help","comment":"Нужен инструмент","phone":"+79990000002","expected_revision":2}') ->>'ok')::boolean,'help saved');
select pg_temp.check_contract((select assignee_id='00000000-0000-4000-8000-000000000001' and issue_code='contact_help' from bos_control_private.tasks where order_id=701 and resolved_at is null),'help goes to manager');
select pg_temp.check_contract((select status='В работе' and master_staff_id='00000000-0000-4000-8000-000000000003' from public.orders where id=701),'help no reassignment');
select pg_temp.check_contract((public.bos_contact_action('00000000-0000-4000-8000-000000000003','recordContactResult','{"id":701,"attempt_id":"declined_reason1","result":"client_declined","comment":"Дорого","phone":"+79990000002","expected_revision":3}') ->>'ok')::boolean,'declined saved');
select pg_temp.check_contract((select status='В работе' from public.orders where id=701),'declined never cancels');
-- Existing report updates are permitted without contact fields.
update public.orders set report_act_url='fixture-act' where id=701;
insert into public.orders(id,master_staff_id,status) values(703,'00000000-0000-4000-8000-000000000003','В работе');
select pg_temp.check_contract((select master_contact_control_active from public.orders where id=703),'new assignment enrolled');
select pg_temp.check_contract((select count(*)=1 from bos_control_private.tasks where order_id=703 and issue_code='contact_first' and resolved_at is null),'first contact created on new assignment');
reset role;
update bos_control_private.contact_config set reminders_enabled=true;
update bos_control_private.tasks set due_at=now()-interval '3 hours',escalation_due_at=now()-interval '1 hour' where order_id=703;
select bos_control_private.tick();
select pg_temp.check_contract((select reminded_at is not null and escalated_at is null from bos_control_private.tasks where order_id=703),'server tick reminds master first without push');
select bos_control_private.tick();select bos_control_private.tick();
select pg_temp.check_contract((select escalated_at is not null from bos_control_private.tasks where order_id=703),'later tick escalates with push off');
create temporary table before_transfer as select * from bos_control_private.tasks where order_id=703;
grant select on before_transfer to service_role;
set local role service_role;
update public.orders set master_staff_id='00000000-0000-4000-8000-000000000004' where id=703;
select pg_temp.check_contract((select t.assignee_id='00000000-0000-4000-8000-000000000004' and t.due_at=b.due_at and t.escalated_at=b.escalated_at and bos_control_private.current_task(t) from bos_control_private.tasks t join before_transfer b on t.id=b.id),'reassign retains deadline/escalation and active task');
select pg_temp.check_contract(jsonb_array_length(public.bos_control_action('00000000-0000-4000-8000-000000000003','controlList')->'tasks')=0,'old master loses contact tasks');
reset role;
update bos_control_private.contact_config set pilot_staff_ids=array['00000000-0000-4000-8000-000000000003'::uuid];
select bos_control_private.tick();
select pg_temp.check_contract((select reminded_at is not null from bos_control_private.tasks where order_id=703),'transferred obligation continues outside enrollment allowlist');
set local role service_role;
select pg_temp.check_contract((public.bos_contact_action('00000000-0000-4000-8000-000000000004','contactPolicy','{"id":703}')->>'enabled')::boolean,'new responsible master can update inherited obligation');
update public.orders set status='Отменена' where id=703;
select pg_temp.check_contract(not exists(select 1 from bos_control_private.tasks where order_id=703 and resolved_at is null),'cancel stops contact obligations');
reset role;
select pg_temp.check_contract(not has_function_privilege('authenticated','public.bos_contact_action(uuid,text,jsonb)','EXECUTE'),'browser cannot impersonate RPC actor');
set local role service_role;
insert into public.orders(id,master_staff_id,status,time_slot) values(704,'00000000-0000-4000-8000-000000000003','В работе','22:00 — 24:00');
select pg_temp.check_contract((public.bos_contact_action('00000000-0000-4000-8000-000000000003','recordContactResult',jsonb_build_object('id',704,'attempt_id','end_midnight_01','result','agreed','phone','+79990000002','expected_revision',0,'scheduled_date',(now() at time zone 'Europe/Moscow')::date+1,'scheduled_time','22:00')) ->>'ok')::boolean,'visit ending at midnight allowed');
select pg_temp.check_contract((select time_slot='22:00–24:00' from public.orders where id=704),'duration parser supports spaces/em dash/midnight');
reset role;
-- A busy queue cannot starve tasks behind completed reminder stages.
set local role service_role;
insert into public.orders(id,master_staff_id,status) select x,'00000000-0000-4000-8000-000000000003','В работе' from generate_series(1000,1205) x;
reset role;
update bos_control_private.tasks set due_at=now()-interval '1 minute',escalation_due_at=now()-interval '1 minute' where order_id>=1000;
select bos_control_private.tick();select bos_control_private.tick();select bos_control_private.tick();select bos_control_private.tick();
select pg_temp.check_contract(not exists(select 1 from bos_control_private.tasks where order_id>=1000 and (reminded_at is null or escalated_at is null)),'large queue makes progress past finished stages');
-- Disabling preserves normal writes, while stale automation cannot revive afterwards.
update bos_control_private.contact_config set enabled=false;
set local role service_role;
update public.orders set master_contact_status='no_answer',master_contact_updated_at=clock_timestamp(),master_contact_callback_at=now()+interval '1 day' where id=1205;
reset role;
update bos_control_private.contact_config set enabled=true;
select pg_temp.check_contract(not exists(select 1 from bos_control_private.tasks where order_id=1205 and resolved_at is null),'legacy save while disabled invalidates old obligation');
-- All waiting outcomes require a concrete deadline; history retry cannot revive an older result.
set local role service_role;
do $$ declare outcome text; revision bigint; response jsonb; begin
 foreach outcome in array array['thinking','waiting_delivery','call_later','other'] loop
  select master_contact_revision into revision from public.orders where id=704;
  response:=public.bos_contact_action('00000000-0000-4000-8000-000000000003','recordContactResult',jsonb_build_object('id',704,'attempt_id','waiting_'||outcome,'result',outcome,'comment','test reason','phone','+79990000002','expected_revision',revision));
  perform pg_temp.check_contract((response->>'status')::integer=400,outcome||' deadline required');
  response:=public.bos_contact_action('00000000-0000-4000-8000-000000000003','recordContactResult',jsonb_build_object('id',704,'attempt_id','waiting_'||outcome,'result',outcome,'comment','test reason','phone','+79990000002','expected_revision',revision,'callback_at',now()+interval '1 day'));
  perform pg_temp.check_contract((response->>'ok')::boolean,outcome||' saved atomically');
 end loop;
end $$;
select pg_temp.check_contract((public.bos_contact_action('00000000-0000-4000-8000-000000000003','recordContactResult',jsonb_build_object('id',701,'attempt_id','outcome_no_answer','result','no_answer','phone','+79990000002','expected_revision',0,'callback_at',now()+interval '1 hour'))->>'idempotent')::boolean,'old exact retry acknowledged after newer result');
select pg_temp.check_contract((select master_contact_status='client_declined' from public.orders where id=701),'old retry never resurrects outcome');
select pg_temp.check_contract((public.bos_contact_action('00000000-0000-4000-8000-000000000003','recordContactResult',jsonb_build_object('id',701,'attempt_id','outcome_no_answer','result','thinking','phone','+79990000002','expected_revision',0,'callback_at',now()+interval '1 hour'))->>'status')::int=409,'same receipt changed payload rejected');
update public.orders set status='Выполнена' where id=704;
select pg_temp.check_contract(not exists(select 1 from bos_control_private.tasks where order_id=704 and resolved_at is null),'completion stops obligations');
reset role;
-- Current recorded trip defers work minutes; a merely scheduled visit does not.
update bos_control_private.contact_config set enabled=false;
insert into public.orders(id,master_staff_id,status,scheduled_date,time_slot,master_departed_at) values(800,'00000000-0000-4000-8000-000000000003','В работе','2026-10-21','10:00 — 12:30',now());
select pg_temp.check_contract(bos_control_private.contact_due('00000000-0000-4000-8000-000000000003','2026-10-21 10:00+03',60)='2026-10-21 13:30+03','observed current trip defers first contact');
update public.orders set master_departed_at=null where id=800;
select pg_temp.check_contract(bos_control_private.contact_due('00000000-0000-4000-8000-000000000003','2026-10-21 10:00+03',60)='2026-10-21 11:00+03','planned-only trip does not defer');
update bos_control_private.contact_config set enabled=true;
-- Mock transport only; no HTTP leaves the disposable database.
update bos_push_private.runtime set enabled=true;
insert into public.bos_push_subscriptions(staff_id,external_id,endpoint,p256dh,auth_key,revoke_hash) values
 ('00000000-0000-4000-8000-000000000003','staff_master1','https://fcm.googleapis.com/fcm/send/contact-master-fixture','key','auth',repeat('a',64)),
 ('00000000-0000-4000-8000-000000000001','100','https://fcm.googleapis.com/fcm/send/contact-owner-fixture','key','auth',repeat('b',64));
set local role service_role;
insert into public.orders(id,master_staff_id,status) values(900,'00000000-0000-4000-8000-000000000003','В работе');
reset role;
update bos_control_private.tasks set due_at=now()-interval '3 hours',escalation_due_at=now()-interval '1 hour' where order_id=900;
select bos_control_private.tick();
select pg_temp.check_contract((select count(*)=1 from public.bos_push_deliveries where order_id=900 and event_type='control_due'),'first stage enqueues master only');
select public.bos_push_claim();
create temporary table contact_claim as select id,lease_token from public.bos_push_deliveries where order_id=900 and event_type='control_due';
select pg_temp.check_contract((select public.bos_push_delivery(id,lease_token) is not null from contact_claim),'sender permits live task');
update bos_control_private.contact_config set reminders_enabled=false;
select pg_temp.check_contract((select public.bos_push_delivery(id,lease_token) is null from contact_claim),'reminders off rejects already claimed delivery');
update bos_control_private.contact_config set reminders_enabled=true,enabled=false;
select pg_temp.check_contract((select public.bos_push_delivery(id,lease_token) is null from contact_claim),'feature off rejects already claimed delivery');
update bos_control_private.contact_config set enabled=true;
select bos_control_private.tick();select bos_control_private.tick();
select pg_temp.check_contract((select count(*)=2 from public.bos_push_deliveries where order_id=900 and event_type='control_due'),'one master and one manager delivery without duplicates');
set local role service_role;
select public.bos_contact_action('00000000-0000-4000-8000-000000000003','recordContactResult',jsonb_build_object('id',900,'attempt_id','new_deadline_001','result','no_answer','phone','+79990000002','expected_revision',0,'callback_at',now()+interval '1 day'));
reset role;
select pg_temp.check_contract((select public.bos_push_delivery(id,lease_token) is null from contact_claim),'new outcome discards previous claimed reminder');
select pg_temp.check_contract((select count(*)=1 from bos_control_private.tasks where order_id=900 and resolved_at is null and due_at>now()),'one current future obligation after replacement');
rollback;
