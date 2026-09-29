-- Minimal disposable contract schema, not a replacement for the application schema.
BEGIN;
CREATE TABLE public.orders (
 id integer PRIMARY KEY, status text, report_review_status text,
 master_workflow_stage text, master_called_at timestamptz, master_agreed_at timestamptz,
 master_departed_at timestamptz, master_arrived_at timestamptz, master_started_at timestamptz, completed_at timestamptz,
 report_type text, report_act_url text, report_measurement_url text, report_photo_urls text,
 report_uploaded_at timestamptz, report_upload_token text, report_archive_url text,
 drive_archive_status text, drive_archive_folder_id text, drive_archive_url text,
 drive_archive_error text, drive_archived_at timestamptz,
 report_reviewed_by text, report_reviewed_at timestamptz, report_review_comment text,
 master_payout numeric, manager_payout numeric, dispatcher_payout numeric, updated_at timestamptz
);
CREATE FUNCTION pg_temp.check_contract(ok boolean, detail text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %',detail; END IF; END $$;
