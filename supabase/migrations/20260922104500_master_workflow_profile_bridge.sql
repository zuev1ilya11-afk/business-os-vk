create or replace function public.capture_master_workflow_stage_request()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  marker constant text := '@@BOS_WF1@@|';
  payload text;
  sep integer;
  order_text text;
  requested_stage text;
  target_order_id bigint;
  current_stage text;
  affected integer;
begin
  if new.district is null or left(new.district, char_length(marker)) <> marker then
    return new;
  end if;

  if old.role <> 'master' then
    raise exception 'Этап работы может менять только мастер';
  end if;

  payload := substr(new.district, char_length(marker) + 1);
  sep := strpos(payload, '|');
  if sep <= 1 then
    raise exception 'Некорректный запрос этапа работы';
  end if;

  order_text := left(payload, sep - 1);
  requested_stage := btrim(substr(payload, sep + 1));

  if order_text !~ '^[0-9]+$' then
    raise exception 'Некорректный номер заявки';
  end if;
  if requested_stage not in ('departed', 'started') then
    raise exception 'Неверный этап работы';
  end if;

  target_order_id := order_text::bigint;

  select case
           when master_workflow_stage = 'arrived' then 'departed'
           when master_workflow_stage in ('assigned', 'departed', 'started') then master_workflow_stage
           else 'assigned'
         end
    into current_stage
    from public.orders
   where id = target_order_id
     and master_staff_id = old.id
     and status not in ('Выполнена', 'Отменена');

  if not found then
    raise exception 'Заявка не найдена, завершена или назначена другому мастеру';
  end if;

  if requested_stage = current_stage then
    new.district := old.district;
    return new;
  end if;

  if not (
    (current_stage = 'assigned' and requested_stage = 'departed') or
    (current_stage = 'departed' and requested_stage = 'started')
  ) then
    raise exception 'Этапы нужно отмечать по порядку';
  end if;

  update public.orders
     set master_workflow_stage = requested_stage,
         master_departed_at = case when requested_stage = 'departed' then coalesce(master_departed_at, now()) else master_departed_at end,
         master_started_at = case when requested_stage = 'started' then coalesce(master_started_at, now()) else master_started_at end,
         updated_at = now(),
         sync_status = 'pending_sheet'
   where id = target_order_id
     and master_staff_id = old.id
     and status not in ('Выполнена', 'Отменена');

  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Не удалось сохранить этап работы';
  end if;

  new.district := old.district;
  return new;
end;
$$;

drop trigger if exists business_staff_master_workflow_bridge on public.business_staff;
create trigger business_staff_master_workflow_bridge
before update of district on public.business_staff
for each row
execute function public.capture_master_workflow_stage_request();
