-- Optional operational step AFTER separate approval; not an automatic migration.
-- Run in the existing business-os database only if pg_cron is already configured.
-- Do not install/reconfigure an extension or activate push from this script.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
  RAISE EXCEPTION 'pg_cron unavailable: use the documented local systemd timer';
 END IF;
END $$;
-- A named job is updated in place, so repeating this script does not add jobs.
SELECT cron.schedule('bos-contact-control','* * * * *','SELECT bos_control_private.tick()');
COMMIT;
