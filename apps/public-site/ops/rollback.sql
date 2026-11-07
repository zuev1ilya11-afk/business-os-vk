-- Stop website/API website feature first. This retains all data in a closed archive.
-- Run only on an approved target with a verified backup. No DROP/DELETE/TRUNCATE.
begin;
create schema website_rollback_20261106;
revoke all on schema website_rollback_20261106 from public;
create table website_rollback_20261106.catalog_publication_state as
 select c.id,c.published from public.client_catalog c join public.website_service_pages p on p.service_id=c.id;
update public.client_catalog set published=false where id in (select id from website_rollback_20261106.catalog_publication_state);
alter table public.website_schema_version set schema website_rollback_20261106;
alter table public.website_service_pages set schema website_rollback_20261106;
alter table public.website_order_attribution set schema website_rollback_20261106;
alter table public.website_business_leads set schema website_rollback_20261106;
alter table public.website_staff_events set schema website_rollback_20261106;
alter table public.website_reviews set schema website_rollback_20261106;
-- public_phone remains additive and unused by the old API. Never erase shared orders.
commit;
