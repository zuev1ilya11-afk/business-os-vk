-- One-company database, matching mini-app-api's existing order scope.
-- Additive only: no historical UPDATE, payout backfill, or change to Hands integration.
begin;
alter table public.orders add column if not exists work_items jsonb,
 add column if not exists lemana_import_meta jsonb;
alter table public.orders add constraint orders_work_items_array check
 (work_items is null or (jsonb_typeof(work_items)='array' and jsonb_array_length(work_items)<=100));
comment on column public.orders.work_items is 'Main work snapshots: name, quantity, unit, unit_price, amount (LINE total). NULL means legacy text only. Does not own order amount.';
comment on column public.orders.lemana_import_meta is 'Source category/shop/status/timezone, not a work list or approved report. No backfill.';

create function public.bos_order_identity_numbers(o public.orders) returns text[]
 language sql immutable parallel safe set search_path=public,pg_temp as $$
 select array_remove(array[
 nullif(btrim(o.order_number),''),
 case when o.external_source='lemana_pro' then nullif(btrim(o.external_id),'')
      when o.external_id like 'hands:%' then substring(o.external_id from 7) end,
 case when nullif(btrim(o.order_number),'') is null and coalesce(o.external_source,'')<>'lemana_pro'
      and coalesce(o.external_id,'') not like 'hands:%' then o.id::text end
 ],null)
$$;
create function public.bos_lemana_number_guard() returns trigger language plpgsql security definer
 set search_path=public,pg_temp as $$
declare keys text[]; key text; is_lemana boolean;
begin
 keys:=public.bos_order_identity_numbers(new);
 is_lemana:=lower(btrim(coalesce(new.source,''))) in ('лемана про','lemana_pro') or new.external_source='lemana_pro';
 -- Global number lock participates in manual creations too. Sorted keys avoid deadlocks.
 for key in select distinct unnest(keys) order by 1 loop
  perform pg_advisory_xact_lock(704210,hashtext(key));
 end loop;
 if exists(select 1 from public.orders o where o.id is distinct from new.id
   and public.bos_order_identity_numbers(o) && keys
   and (is_lemana or lower(btrim(coalesce(o.source,''))) in ('лемана про','lemana_pro') or o.external_source='lemana_pro'))
 then raise exception 'LEMANA_NUMBER_CONFLICT' using errcode='23505'; end if;
 return new;
end $$;
-- Trigger must see rows hidden by city RLS; only the trigger invokes it.
revoke all on function public.bos_lemana_number_guard() from public,anon,authenticated,service_role;
create trigger aa_bos_lemana_number_guard before insert or update of order_number,source,external_source,external_id
 on public.orders for each row execute function public.bos_lemana_number_guard();

-- Only the authenticated Edge service can call this; actor is rechecked in the same transaction.
create function public.bos_import_lemana_order(p_actor uuid,p_order jsonb) returns jsonb
 language plpgsql security definer set search_path=public,pg_temp as $$
declare actor public.business_staff%rowtype; v public.orders%rowtype; saved public.orders%rowtype;
begin
 select * into actor from public.business_staff where id=p_actor and is_active for share;
 if not found or actor.role::text not in ('owner','manager','dispatcher') then
  raise exception 'IMPORT_FORBIDDEN' using errcode='42501';
 end if;
 select * into v from jsonb_populate_record(null::public.orders,p_order);
 if v.source is distinct from 'Лемана Про' or v.external_source is distinct from 'lemana_pro'
  or v.order_number is null or v.order_number='' or v.order_number is distinct from btrim(v.order_number)
  or length(v.order_number)>80 or v.order_number ~ '[[:cntrl:]]' or v.external_id is distinct from v.order_number
  or coalesce(btrim(v.client),'')='' or coalesce(btrim(v.address),'')='' or coalesce(v.phone,'') !~ '^\+7[0-9]{10}$'
  or v.work is distinct from '' or v.status is null or v.status::text not in ('Новая','Назначена','В работе','Отменена')
  or v.amount is null or v.amount::text in ('NaN','Infinity','-Infinity') or v.amount<0 or v.amount>1000000000
  or v.original_amount is distinct from v.amount or v.created_at is null or v.received_date is null
  or v.amount_confirmed is distinct from true or jsonb_typeof(v.lemana_import_meta) is distinct from 'object'

  or v.master_payout is null or v.manager_payout is null or v.dispatcher_payout is null
  or exists(select 1 from unnest(array[v.master_payout,v.manager_payout,v.dispatcher_payout]) p
    where p::text in ('NaN','Infinity','-Infinity') or p<0 or p>1000000000 or p::numeric<>round(p::numeric,2)) then raise exception 'INVALID_IMPORT_ROW' using errcode='22023'; end if;
 if v.master_staff_id is not null then
  perform 1 from public.business_staff where id=v.master_staff_id and is_active and role::text='master' for share;
  if not found then return jsonb_build_object('kind','skipped','reason','Мастер больше недоступен. Повторите предпросмотр'); end if;
 end if;
 perform pg_advisory_xact_lock(704210,hashtext(v.order_number));
 if exists(select 1 from public.orders o where v.order_number=any(public.bos_order_identity_numbers(o))) then
  return jsonb_build_object('kind','skipped','reason','Номер уже существует. Существующая заявка не изменена');
 end if;
 begin
  insert into public.orders(source,external_source,external_id,order_number,client,phone,address,work,status,
   amount,original_amount,amount_confirmed,master_staff_id,master_name,master_payout,manager_payout,dispatcher_payout,
   created_at,received_date,scheduled_date,scheduled_time,city,created_by_vk_id,lemana_import_meta,sync_status,source_updated_at)
  values('Лемана Про','lemana_pro',v.order_number,v.order_number,v.client,v.phone,v.address,'',v.status,
   v.amount,v.amount,true,v.master_staff_id,coalesce(v.master_name,''),v.master_payout,v.manager_payout,v.dispatcher_payout,
   v.created_at,v.received_date,v.scheduled_date,v.scheduled_time,coalesce(v.city,''),actor.external_id,v.lemana_import_meta,'synced',now())
  returning * into saved;
 exception when unique_violation then
  return jsonb_build_object('kind','skipped','reason','Номер уже существует. Существующая заявка не изменена');
 end;
 return jsonb_build_object('kind','created','order',to_jsonb(saved));
end $$;
revoke all on function public.bos_import_lemana_order(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.bos_import_lemana_order(uuid,jsonb) to service_role;
commit;
