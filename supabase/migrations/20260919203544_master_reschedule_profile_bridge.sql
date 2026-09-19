create or replace function public.capture_master_reschedule_request()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  payload text;
  sep integer;
  order_text text;
  target_order_id bigint;
  reason text;
begin
  if new.district is null or left(new.district, 11) <> '@@BOS_R1@@|' then
    return new;
  end if;

  if old.role <> 'master' then
    raise exception 'Запрос на перенос может отправить только мастер';
  end if;

  payload := substr(new.district, 12);
  sep := strpos(payload, '|');
  if sep <= 1 then
    raise exception 'Некорректный запрос на перенос';
  end if;

  order_text := left(payload, sep - 1);
  reason := btrim(substr(payload, sep + 1));

  if order_text !~ '^[0-9]+$' then
    raise exception 'Некорректный номер заявки';
  end if;
  if char_length(reason) < 3 then
    raise exception 'Укажите причину переноса';
  end if;
  if char_length(reason) > 80 then
    raise exception 'Причина переноса должна быть не длиннее 80 символов';
  end if;

  target_order_id := order_text::bigint;

  update public.orders
     set reschedule_requested = true,
         reschedule_reason = reason,
         reschedule_requested_at = now(),
         reschedule_requested_by = old.id,
         updated_at = now()
   where id = target_order_id
     and master_staff_id = old.id
     and status not in ('Выполнена', 'Отменена');

  if not found then
    raise exception 'Заявка не найдена, завершена или назначена другому мастеру';
  end if;

  new.district := old.district;
  return new;
end;
$$;

drop trigger if exists business_staff_master_reschedule_bridge on public.business_staff;
create trigger business_staff_master_reschedule_bridge
before update of district on public.business_staff
for each row
execute function public.capture_master_reschedule_request();
