-- Read-only checks in the EXISTING database after applying the migration.
SELECT current_database() AS database_name,
 to_regprocedure('public.bos_contact_action(uuid,text,jsonb)') IS NOT NULL AS contact_rpc,
 to_regprocedure('bos_control_private.tick()') IS NOT NULL AS server_tick,
 EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') AS pg_cron_available;
SELECT enabled,reminders_enabled,first_contact_minutes,escalation_minutes,reminder_limit,
 company_start,company_end,company_days,time_zone,manager_id,cardinality(pilot_staff_ids) AS pilot_size
 FROM bos_control_private.contact_config;
SELECT c.manager_id,b.role,b.is_active FROM bos_control_private.contact_config c
 LEFT JOIN public.business_staff b ON b.id=c.manager_id;
SELECT p.id,b.role,b.is_active FROM bos_control_private.contact_config c
 CROSS JOIN LATERAL unnest(c.pilot_staff_ids) p(id) LEFT JOIN public.business_staff b ON b.id=p.id;
SELECT enabled AS push_enabled, worker_url IS NOT NULL AS push_worker_configured FROM bos_push_private.runtime;
SELECT count(*) FILTER(WHERE resolved_at IS NULL) AS active,
 count(*) FILTER(WHERE resolved_at IS NULL AND due_at<now()) AS overdue,
 count(*) FILTER(WHERE resolved_at IS NULL AND escalated_at IS NOT NULL) AS escalated
 FROM bos_control_private.tasks WHERE contact_revision IS NOT NULL;
