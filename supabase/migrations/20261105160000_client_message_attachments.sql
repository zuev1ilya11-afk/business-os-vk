begin;
-- Broaden only the newly introduced private attachment table to support the
-- customer's general company thread. Ownership remains mandatory on every file.
alter table public.client_attachments alter column order_id drop not null;
alter table public.client_attachments add column if not exists message_id bigint references public.client_messages(id);
create index if not exists client_attachments_message on public.client_attachments(message_id) where message_id is not null;
create index if not exists client_attachments_account on public.client_attachments(account_id);
insert into public.client_schema_version(version) values(5) on conflict do nothing;
commit;
