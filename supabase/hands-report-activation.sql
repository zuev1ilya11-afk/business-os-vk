-- Run only after worker deployment, contract probe and release checks.
-- Only subsequent approvals are captured; historical accepted reports stay untouched.
begin;
update bos_hands_private.runtime set enabled=true,
  worker_url='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/hands-report-api',next_kick_at='-infinity' where singleton;
select cron.schedule('bos-hands-report-worker','* * * * *','select bos_hands_private.kick()');
select bos_hands_private.kick();
commit;
