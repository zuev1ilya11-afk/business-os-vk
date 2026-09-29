-- Operational activation, NOT an automatically-applied migration.
-- Run only after the tested new push-api has been deployed. No key values leave the database.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_net;
UPDATE bos_push_private.runtime SET
 worker_url='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/push-api',
 enabled=true,next_kick_at='-infinity' WHERE singleton;
SELECT cron.schedule('bos-web-push-recovery','* * * * *','SELECT bos_push_private.maintenance()');
SELECT bos_push_private.kick();
COMMIT;
