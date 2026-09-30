select pg_temp.assert((select count(*)=1 from vault.decrypted_secrets),'migration is idempotent');
select pg_temp.assert(not (select enabled from bos_hands_private.runtime),'starts disabled');
select pg_temp.assert(not has_function_privilege('anon','public.bos_hands_report_runtime()','execute'),'runtime is private');
select pg_temp.assert(not has_function_privilege('authenticated','public.bos_hands_report_retry(bigint,uuid,boolean,boolean)','execute'),'retry is service-only');
select pg_temp.assert(not has_schema_privilege('authenticated','bos_hands_private','usage'),'private queue schema');
update bos_hands_private.runtime set enabled=true,worker_url='https://test.invalid';
select pg_temp.assert((select count(*)=0 from bos_hands_private.deliveries),'no historical backfill');
update public.orders set report_review_status='approved',status='Выполнена' where id in (2,3);
update public.orders set report_review_status='approved' where id in (1,2);
select pg_temp.assert((select count(*)=1 from bos_hands_private.deliveries),'one new Hands approval only');
update public.orders set work='Changed after approval' where id=2;
select pg_temp.assert((select snapshot->>'work'='Frozen work' from bos_hands_private.deliveries),'immutable accepted snapshot');

do $$ declare d jsonb; job_id uuid; job_lease uuid; job_version uuid;
begin
 d:=public.bos_hands_report_claim();job_id:=(d->>'id')::uuid;job_lease:=(d->>'lease')::uuid;
 perform pg_temp.assert(d->>'state'='processing','claimed');
 perform pg_temp.assert(public.bos_hands_report_claim() is null,'concurrent worker cannot claim leased job');
 perform pg_temp.assert(not public.bos_hands_report_step(job_id,gen_random_uuid(),0,'begin'),'wrong lease blocked');
 perform pg_temp.assert(not public.bos_hands_report_step(job_id,job_lease,1,'begin'),'wrong step blocked');
 perform pg_temp.assert(public.bos_hands_report_step(job_id,job_lease,0,'begin'),'intent persisted');
 perform pg_temp.assert(not public.bos_hands_report_step(job_id,job_lease,0,'begin'),'same intent cannot be issued twice');
 perform pg_temp.assert(public.bos_hands_report_step(job_id,job_lease,0,'advance'),'first file confirmed');
 perform pg_temp.assert(public.bos_hands_report_step(job_id,job_lease,1,'begin'),'second intent');
 update bos_hands_private.deliveries set locked_until=now()-interval '1 second' where deliveries.id=job_id;
 perform pg_temp.assert((public.bos_hands_report_claim()->>'attention')::boolean,'crashed send is ambiguous');
 perform pg_temp.assert(public.bos_hands_report_claim() is null,'uncertain send never auto-replayed');
 select deliveries.version into job_version from bos_hands_private.deliveries where deliveries.id=job_id;
 perform pg_temp.assert(not public.bos_hands_report_retry(2,job_version,false),'uncertain retry requires explicit confirmation');
 perform pg_temp.assert(not public.bos_hands_report_retry(2,gen_random_uuid(),true),'stale confirmation blocked');
 perform pg_temp.assert(public.bos_hands_report_retry(2,job_version,true),'confirmed missing step may resume');
 d:=public.bos_hands_report_claim();job_lease:=(d->>'lease')::uuid;
 perform pg_temp.assert((d->>'step')::int=1,'confirmed first file is not repeated');
 perform pg_temp.assert(public.bos_hands_report_step(job_id,job_lease,1,'begin'),'resumed intent');
 perform pg_temp.assert(public.bos_hands_report_step(job_id,job_lease,1,'advance'),'resumed confirmation');
 perform pg_temp.assert(public.bos_hands_report_step(job_id,job_lease,2,'begin',null,false,'Отчёт о выполнении',true),'final report intent');
 perform pg_temp.assert(public.bos_hands_report_step(job_id,job_lease,2,'sent'),'provider confirmed report');
 perform pg_temp.assert(public.bos_hands_report_claim() is null,'sent receipt is terminal');
 perform pg_temp.assert(public.bos_hands_report_status(2)->>'state'='sent','operator status');
 perform pg_temp.assert(not public.bos_hands_report_step(job_id,job_lease,2,'sent'),'repeated acknowledgement blocked');
end $$;

-- Operator reconciliation of an ambiguous final receipt does not resend it.
update public.orders set report_review_status='pending',status='В работе',report_upload_token='reconciled' where id=2;
update public.orders set report_review_status='approved',status='Выполнена' where id=2;
do $$ declare d jsonb; job_version uuid; begin
 d:=public.bos_hands_report_claim();
 perform pg_temp.assert(public.bos_hands_report_step((d->>'id')::uuid,(d->>'lease')::uuid,0,'begin',null,false,'Отчёт о выполнении',true),'reconcile intent');
 perform pg_temp.assert(public.bos_hands_report_step((d->>'id')::uuid,(d->>'lease')::uuid,0,'attention','Timeout',true),'ambiguous result');
 job_version:=(public.bos_hands_report_status(2)->>'version')::uuid;
 perform pg_temp.assert(not public.bos_hands_report_retry(2,job_version,false,true),'received requires explicit check');
 perform pg_temp.assert(public.bos_hands_report_retry(2,job_version,true,true),'operator confirms received');
 perform pg_temp.assert(public.bos_hands_report_status(2)->>'state'='sent','confirmed final receipt is terminal');
 perform pg_temp.assert(public.bos_hands_report_claim() is null,'confirmed receipt is not re-sent');
end $$;

-- A reset/cancellation after capture prevents the next side effect.
update public.orders set report_review_status='pending',status='В работе',report_upload_token='newer' where id=2;
update public.orders set report_review_status='approved',status='Выполнена' where id=2;
do $$ declare d jsonb; begin
 d:=public.bos_hands_report_claim();
 update public.orders set status='Отменена' where id=2;
 perform pg_temp.assert(not public.bos_hands_report_step((d->>'id')::uuid,(d->>'lease')::uuid,0,'begin'),'cancelled order cannot send');
 perform pg_temp.assert(public.bos_hands_report_status(2)->>'state'='cancelled','cancellation visible');
end $$;

-- A failed pg_net wake does not lose the durable receipt or roll back approval.
create or replace function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$ begin raise exception 'network unavailable';end $$;
update bos_hands_private.runtime set next_kick_at='-infinity';
update public.orders set report_review_status='pending',status='В работе',report_upload_token='last' where id=2;
update public.orders set report_review_status='approved',status='Выполнена' where id=2;
select pg_temp.assert(public.bos_hands_report_status(2)->>'state'='queued','wake failure retains queue');
select pg_temp.assert((select amount=1000 and master_payout=552.5 from public.orders where id=2),'financial fields unchanged');
rollback;
