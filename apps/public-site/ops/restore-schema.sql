-- Restore the archived schema after correcting the release; no data is overwritten.
begin;
alter table website_rollback_20261106.website_schema_version set schema public;
alter table website_rollback_20261106.website_service_pages set schema public;
alter table website_rollback_20261106.website_order_attribution set schema public;
alter table website_rollback_20261106.website_business_leads set schema public;
alter table website_rollback_20261106.website_staff_events set schema public;
alter table website_rollback_20261106.website_reviews set schema public;
update public.client_catalog c set published=s.published from website_rollback_20261106.catalog_publication_state s where s.id=c.id;
commit;
