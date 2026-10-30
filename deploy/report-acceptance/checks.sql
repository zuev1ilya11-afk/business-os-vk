-- Read-only post-deployment checks. No personal data, tokens or signed links.
select to_regprocedure('public.bos_drive_claim()') is not null as queue_installed;
select tgname,tgenabled from pg_trigger where tgrelid='public.orders'::regclass and tgname='bos_drive_capture';
select state,count(*),min(next_attempt_at) as earliest_retry from bos_drive_private.jobs group by state;
select report_review_status,drive_archive_status,count(*) from public.orders
 where report_uploaded_at is not null group by report_review_status,drive_archive_status;
select has_function_privilege('anon','public.bos_drive_claim()','execute') as anon_must_be_false,
 has_function_privilege('authenticated','public.bos_drive_claim()','execute') as authenticated_must_be_false;
