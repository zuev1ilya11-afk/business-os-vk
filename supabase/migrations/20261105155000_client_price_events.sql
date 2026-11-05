begin;
alter table public.client_document_versions add column if not exists body text;
-- Legacy employee price edits remain possible, but are never represented to the
-- customer as acceptance of a different estimate. API projects effective validity.
create or replace function public.bos_client_order_event() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare e bigint; kind text; label text;
begin
 if new.client_account_id is null then return new; end if;
 if TG_OP='INSERT' then kind:='created'; label:='Заявка принята компанией';
 elsif old.client_account_id is distinct from new.client_account_id then kind:='linked'; label:='Заявка подключена к вашему кабинету';
 elsif old.status is distinct from new.status then
  kind:='status'; label:=case new.status::text when 'Выполнена' then 'Работы выполнены' when 'Отменена' then 'Заявка отменена' else 'Компания обновила заявку' end;
 elsif old.amount is distinct from new.amount or old.work_items is distinct from new.work_items then
  if exists(select 1 from client_estimates x where x.order_id=new.id and x.accepted_at is not null and x.total=new.amount and x.items=new.work_items and x.version=(select max(v.version) from client_estimates v where v.order_id=new.id)) then return new; end if;
  kind:='price'; label:='Стоимость или состав работ изменились. Требуется согласовать актуальную смету';
 elsif old.master_staff_id is distinct from new.master_staff_id then kind:='master'; label:='Назначение мастера обновлено';
 elsif old.master_agreed_at is distinct from new.master_agreed_at or old.scheduled_date is distinct from new.scheduled_date or old.scheduled_time is distinct from new.scheduled_time or old.time_slot is distinct from new.time_slot then
  kind:='visit'; label:=case when new.master_agreed_at is not null then 'Время визита согласовано' else 'Время визита уточняется' end;
 else return new; end if;
 insert into client_events(order_id,type,text) values(new.id,kind,label) returning id into e;
 insert into client_notifications(event_id,account_id,kind) values(e,new.client_account_id,kind) on conflict(event_id) do nothing;
 return new;
end $$;
revoke all on function public.bos_client_order_event() from public;
insert into public.client_schema_version(version) values(4) on conflict do nothing;
commit;
