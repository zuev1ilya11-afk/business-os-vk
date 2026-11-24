-- Install once in the same PostgreSQL database that serves the staff orders list.
BEGIN;
DO $setup$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hm_site_intake') THEN
    CREATE ROLE hm_site_intake LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$setup$;
CREATE SCHEMA IF NOT EXISTS hm_site_private;
REVOKE ALL ON SCHEMA hm_site_private FROM PUBLIC;
CREATE TABLE IF NOT EXISTS hm_site_private.receipts (
  request_id uuid PRIMARY KEY,
  payload_hash text NOT NULL,
  phone_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hm_site_receipts_created ON hm_site_private.receipts(created_at);
REVOKE ALL ON hm_site_private.receipts FROM PUBLIC, hm_site_intake;

CREATE OR REPLACE FUNCTION hm_site_private.submit(
  request_id uuid, customer text, phone text, task text, kind text, consent_version text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  prior text;
  fingerprint text := encode(sha256(convert_to(jsonb_build_array(customer, phone, task, kind, consent_version)::text, 'UTF8')), 'hex');
  phone_key text := encode(sha256(convert_to(phone, 'UTF8')), 'hex');
BEGIN
  IF request_id IS NULL OR customer IS NULL OR length(trim(customer)) NOT BETWEEN 1 AND 100
    OR phone IS NULL OR phone !~ '^\+7[0-9]{10}$' OR task IS NULL OR length(trim(task)) NOT BETWEEN 3 AND 1200
    OR kind IS NULL OR kind NOT IN ('home', 'business') OR consent_version IS DISTINCT FROM '2026-11-24' THEN
    RETURN 'invalid';
  END IF;
  -- Serialize duplicate checks and rate counters across both release slots.
  PERFORM pg_advisory_xact_lock(21846, 11924);
  SELECT r.payload_hash INTO prior FROM hm_site_private.receipts r WHERE r.request_id = submit.request_id;
  IF FOUND THEN RETURN CASE WHEN prior = fingerprint THEN 'accepted' ELSE 'conflict' END; END IF;
  DELETE FROM hm_site_private.receipts WHERE created_at < now() - interval '30 days';
  IF (SELECT count(*) FROM hm_site_private.receipts WHERE created_at > now() - interval '1 hour') >= 120
    OR (SELECT count(*) FROM hm_site_private.receipts WHERE phone_hash = phone_key AND created_at > now() - interval '1 hour') >= 4 THEN
    RETURN 'limited';
  END IF;
  INSERT INTO public.orders (client, phone, address, work, city, status, source, external_source, external_id,
    received_date, source_updated_at, sync_status, comment, amount_confirmed, amount, original_amount, master_payout, manager_payout, dispatcher_payout)
  VALUES (customer, phone, 'Уточнить при звонке', task, 'Санкт-Петербург', 'В работе', 'website', 'website',
    'callback_' || request_id, (now() AT TIME ZONE 'Europe/Moscow')::date, now(), 'synced',
    concat_ws(E'\n', CASE WHEN kind = 'business' THEN 'Обращение компании с сайта' ELSE 'Обратный звонок с сайта' END,
      'Согласие на обработку обращения: ' || consent_version || ', ' || to_char(now() AT TIME ZONE 'Europe/Moscow','YYYY-MM-DD HH24:MI:SS') || ' МСК'), false, 0, 0, 0, 0, 0);
  INSERT INTO hm_site_private.receipts (request_id, payload_hash, phone_hash, created_at) VALUES (request_id, fingerprint, phone_key, now());
  RETURN 'accepted';
END
$fn$;
REVOKE ALL ON FUNCTION hm_site_private.submit(uuid,text,text,text,text,text) FROM PUBLIC;
GRANT USAGE ON SCHEMA hm_site_private TO hm_site_intake;
GRANT EXECUTE ON FUNCTION hm_site_private.submit(uuid,text,text,text,text,text) TO hm_site_intake;
COMMIT;
