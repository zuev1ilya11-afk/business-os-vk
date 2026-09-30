-- Run only after the model key is configured, tests pass and the live pilot is reviewed.
BEGIN;
UPDATE bos_avito_private.runtime SET enabled=true,started_at=coalesce(started_at,now()),
 worker_url='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/avito-assistant-api',
 next_run_at='-infinity' WHERE singleton;
SELECT cron.schedule('bos-avito-assistant','* * * * *','SELECT bos_avito_private.kick()');
COMMIT;
-- Stop immediately: UPDATE bos_avito_private.runtime SET enabled=false WHERE singleton;
