-- Read only. IDs and technical state only; no client contacts or signed URLs.
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SELECT json_build_object(
 'guard_exists',to_regprocedure('public.guard_order_completion()') IS NOT NULL,
 'guard_body_md5',(SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.guard_order_completion()')),
 'submission_fix_present',(SELECT prosrc LIKE '%submitting_report%' FROM pg_proc WHERE oid=to_regprocedure('public.guard_order_completion()')),
 'triggers',(SELECT json_agg(json_build_object('name',tgname,'enabled',tgenabled)) FROM pg_trigger WHERE tgrelid='public.orders'::regclass AND NOT tgisinternal));
-- Candidates, not proof of a reset. Reconcile against history before any repair.
SELECT json_build_object('id',id,'status',status,'review',report_review_status,
 'stage',master_workflow_stage,'uploaded_at',report_uploaded_at,'updated_at',updated_at,
 'has_token',nullif(report_upload_token,'') IS NOT NULL,
 'has_act',nullif(report_act_url,'') IS NOT NULL,
 'has_photos',coalesce(report_photo_urls,'[]') NOT IN ('','[]'))
FROM public.orders
WHERE report_review_status IN ('pending','approved')
 AND (report_uploaded_at IS NULL OR nullif(report_act_url,'') IS NULL
      OR coalesce(report_photo_urls,'[]') IN ('','[]')
      OR (status NOT IN ('Выполнена','Отменена') AND master_workflow_stage='assigned'))
ORDER BY updated_at DESC LIMIT 100;
-- A cleared report leaves no conclusive evidence in orders alone.
-- Existing Storage objects can identify candidates; this does NOT prove submission.
SELECT CASE WHEN to_regclass('storage.objects') IS NOT NULL THEN 'storage_metadata_available' ELSE 'storage_metadata_unavailable' END;
ROLLBACK;
