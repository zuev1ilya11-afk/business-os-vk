-- Additive queue leasing. No real delivery provider is enabled by this migration.
begin;
alter table public.client_notifications
 add column lease_token uuid,
 add column lease_until timestamptz,
 add column delivered_at timestamptz;
create index client_notifications_due on public.client_notifications(next_attempt_at,id)
 where status in ('pending','failed');
insert into public.client_schema_version(version) values(3);
commit;
