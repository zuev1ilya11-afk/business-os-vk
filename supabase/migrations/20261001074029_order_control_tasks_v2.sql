-- Additive, opt-in task metadata. No historical backfill or order/payroll writes.
create schema if not exists bos_control_private;
revoke all on schema bos_control_private from public,anon,authenticated;
grant usage on schema bos_control_private to service_role;
create table if not exists bos_control_private.runtime(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
insert into bos_control_private.runtime(singleton) values(true) on conflict do nothing;
create table if not exists bos_control_private.tasks(
 id uuid primary key default gen_random_uuid(), order_id bigint not null references public.orders(id) on delete cascade,
 issue_code text not null check(issue_code in ('reschedule','overdue','unassigned','undated','untimed','agreement','report_review','report_rejected','unfinished_work')),
 assignee_id uuid not null references public.business_staff(id),due_at timestamptz not null,remind boolean not null default false,
 version bigint not null default 1,updated_by uuid not null references public.business_staff(id),updated_at timestamptz not null default now(),
 resolved_at timestamptz,reminder_event uuid not null default gen_random_uuid(),reminder_queued_at timestamptz,
 unique(order_id,issue_code)
);
create index if not exists bos_control_tasks_due on bos_control_private.tasks(due_at) where resolved_at is null;
alter table bos_control_private.tasks enable row level security;
alter table bos_control_private.runtime enable row level security;
revoke all on all tables in schema bos_control_private from public,anon,authenticated;
grant all on all tables in schema bos_control_private to service_role;

-- Same observed facts as order-control.js; validate calendar input without throwing in an order trigger.
create or replace function bos_control_private.issues(o jsonb,at_time timestamptz default now()) returns text[]
language plpgsql stable set search_path='' as $$
declare d date; today date:=(at_time at time zone 'Europe/Moscow')::date; review text:=coalesce(o->>'report_review_status','');
 assigned boolean; transfer boolean:=coalesce(o->>'reschedule_requested'='true',false); result text[]:='{}'; tm text;
begin
 if o is null or coalesce(o->>'status','') in ('Выполнена','Отменена') then return result; end if;
 begin
  if left(coalesce(o->>'scheduled_date',''),10) ~ '^\d{4}-\d{2}-\d{2}$' then d:=left(o->>'scheduled_date',10)::date; end if;
 exception when datetime_field_overflow or invalid_datetime_format then d:=null; end;
 assigned:=coalesce(nullif(btrim(o->>'master_staff_id'),''),nullif(btrim(o->>'master_vk_id'),''),nullif(btrim(o->>'master_id'),''),nullif(btrim(o->>'master_name'),'')) is not null;
 tm:=coalesce(nullif(btrim(o->>'scheduled_time'),''),btrim(o->>'time_slot'),'');
 if transfer then result:=array_append(result,'reschedule'); end if;
 if review='rejected' then result:=array_append(result,'report_rejected');
 elsif nullif(o->>'report_uploaded_at','') is not null and review in ('','pending') then result:=array_append(result,'report_review');
 elsif review<>'approved' then
  if d<today then result:=array_append(result,'overdue'); end if;
  if not assigned then result:=array_append(result,'unassigned'); end if;
  if d is null then result:=array_append(result,'undated');
  elsif tm !~ '^([0-9]|[01][0-9]|2[0-3]):[0-5][0-9]($|[^0-9A-Za-z_])' then result:=array_append(result,'untimed'); end if;
  if assigned and d between today and today+1 and not transfer and nullif(o->>'master_agreed_at','') is null
   and coalesce(o->>'master_workflow_stage','') not in ('departed','arrived','started')
   and nullif(o->>'master_started_at','') is null and nullif(o->>'master_departed_at','') is null then result:=array_append(result,'agreement'); end if;
 end if;
 if coalesce(o->>'uncompleted_work_amount','') ~ '^\d+(\.\d+)?$' and (o->>'uncompleted_work_amount')::numeric>0 then result:=array_append(result,'unfinished_work'); end if;
 return result;
end $$;
create or replace function bos_control_private.current_task(t bos_control_private.tasks) returns boolean
language sql stable set search_path='' as $$
 select t.resolved_at is null and exists(select 1 from public.orders o join public.business_staff b on b.id=t.assignee_id and b.is_active
  where o.id=t.order_id and t.issue_code=any(bos_control_private.issues(to_jsonb(o)))
   and (b.role in ('owner','manager','dispatcher') or (b.role='master' and o.master_staff_id=b.id and t.issue_code in ('agreement','report_rejected'))));
$$;
create or replace function bos_control_private.task_view(t bos_control_private.tasks) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',t.id,'order_id',t.order_id::text,'issue_code',t.issue_code,'assignee_id',t.assignee_id,
  'assignee_name',coalesce(to_jsonb(b)->>'full_name','Сотрудник'),'due_at',t.due_at,'remind',t.remind,'version',t.version,
  'active',bos_control_private.current_task(t),'has_push',exists(select 1 from public.bos_push_subscriptions s where s.staff_id=b.id and s.external_id=b.external_id and s.active and s.expires_at>now()),
  'reminder_status',case when not t.remind then 'off'
   when exists(select 1 from public.bos_push_deliveries d where d.event_id=t.reminder_event and d.state='sent') then 'accepted'
   when t.reminder_queued_at is not null then case when exists(select 1 from public.bos_push_deliveries d where d.event_id=t.reminder_event and d.state in ('pending','sending')) then 'queued' else 'not_delivered' end
   when t.due_at<now()-interval '24 hours' then 'expired' else 'scheduled' end)
 from public.business_staff b where b.id=t.assignee_id;
$$;

-- Called only by the existing signed-session push-api, never directly by browser roles.
create or replace function public.bos_control_action(p_actor uuid,p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql set search_path='' as $$
declare actor public.business_staff; assignee public.business_staff; o public.orders; t bos_control_private.tasks;
 oid bigint; code text; ver bigint; deadline timestamptz; aid uuid; notify boolean; items jsonb; people jsonb; count_all integer;
begin
 select * into actor from public.business_staff where id=p_actor and is_active;
 if actor.id is null or (actor.role in ('owner','manager','dispatcher','master')) is not true then return jsonb_build_object('ok',false,'status',403,'error','Недостаточно прав.'); end if;
 if p_input ? 'order_id' then
  if coalesce(p_input->>'order_id','') !~ '^\d{1,18}$' then return jsonb_build_object('ok',false,'status',400,'error','Некорректная заявка.'); end if;
  oid:=(p_input->>'order_id')::bigint;
 end if;
 code:=p_input->>'issue_code';
 if p_action='controlList' then
  select count(*) into count_all from bos_control_private.tasks x where (actor.role<>'master' or x.assignee_id=actor.id)
   and ((oid is null and bos_control_private.current_task(x)) or (oid=x.order_id and code=x.issue_code));
  select coalesce(jsonb_agg(v),'[]') into items from (select bos_control_private.task_view(x) v from bos_control_private.tasks x
   where (actor.role<>'master' or x.assignee_id=actor.id) and ((oid is null and bos_control_private.current_task(x)) or (oid=x.order_id and code=x.issue_code))
   order by x.due_at,x.id limit 500) q;
  people:='[]';
  if actor.role<>'master' then
   select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',coalesce(to_jsonb(b)->>'full_name','Сотрудник'),'role',b.role,
    'has_push',exists(select 1 from public.bos_push_subscriptions s where s.staff_id=b.id and s.external_id=b.external_id and s.active and s.expires_at>now()))),'[]')
    into people from public.business_staff b where b.is_active and b.role in ('owner','manager','dispatcher','master');
  end if;
  return jsonb_build_object('ok',true,'tasks',items,'staff',people,'more',count_all>500,'server_now',now(),
    'reminders_enabled',exists(select 1 from bos_control_private.runtime r where r.enabled) and exists(select 1 from bos_push_private.runtime r where r.enabled));
 end if;
 if actor.role='master' then return jsonb_build_object('ok',false,'status',403,'error','Назначения меняет диспетчер или руководитель.'); end if;
 if p_action not in ('controlSave','controlClear') or oid is null or code is null or coalesce(p_input->>'expected_version','') !~ '^\d{1,12}$' then
  return jsonb_build_object('ok',false,'status',400,'error','Некорректные параметры поручения.'); end if;
 ver:=(p_input->>'expected_version')::bigint;
 -- Order first, task second: same lock order as the resolution trigger.
 select * into o from public.orders where id=oid for update;
 if o.id is null then return jsonb_build_object('ok',false,'status',404,'error','Заявка не найдена.'); end if;
 select * into t from bos_control_private.tasks where order_id=oid and issue_code=code for update;
 if p_action='controlClear' then
  if t.id is null then return jsonb_build_object('ok',true); end if;
  if t.version<>ver then return jsonb_build_object('ok',false,'status',409,'error','Поручение уже изменено. Откройте его заново.'); end if;
  update bos_control_private.tasks set resolved_at=coalesce(resolved_at,now()),version=version+1,updated_by=actor.id,updated_at=now() where id=t.id;
 else
  if not(code=any(bos_control_private.issues(to_jsonb(o)))) then return jsonb_build_object('ok',false,'status',409,'error','Эта проблема уже решена. Обновите заявки.'); end if;
  begin
   if coalesce(p_input->>'due_at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$' or jsonb_typeof(p_input->'remind') is distinct from 'boolean' then raise invalid_parameter_value; end if;
   aid:=(p_input->>'assignee_id')::uuid;deadline:=(p_input->>'due_at')::timestamptz;notify:=(p_input->>'remind')::boolean;
  exception when others then return jsonb_build_object('ok',false,'status',400,'error','Укажите сотрудника и корректный срок.'); end;
  select * into assignee from public.business_staff where id=aid and is_active;
  if assignee.id is null or (assignee.role in ('owner','manager','dispatcher') or (assignee.role='master' and o.master_staff_id=aid and code in ('agreement','report_rejected'))) is not true then
   return jsonb_build_object('ok',false,'status',400,'error','Этот сотрудник не может отвечать за данную проблему.'); end if;
  -- An identical retry never changes revision/event, even if the original response was lost.
  if t.id is not null and t.resolved_at is null and t.assignee_id=aid and t.due_at=deadline and t.remind=notify then return jsonb_build_object('ok',true,'task',bos_control_private.task_view(t)); end if;
  if coalesce(t.version,0)<>ver then return jsonb_build_object('ok',false,'status',409,'error','Поручение уже изменено. Откройте его заново.'); end if;
  if deadline<=now() or deadline>now()+interval '90 days' then return jsonb_build_object('ok',false,'status',400,'error','Срок должен быть в будущем, не дальше 90 дней.'); end if;
  insert into bos_control_private.tasks(order_id,issue_code,assignee_id,due_at,remind,updated_by)
   values(oid,code,aid,deadline,notify,actor.id)
   on conflict(order_id,issue_code) do update set assignee_id=excluded.assignee_id,due_at=excluded.due_at,remind=excluded.remind,
    updated_by=excluded.updated_by,updated_at=now(),version=bos_control_private.tasks.version+1,resolved_at=null,reminder_event=gen_random_uuid(),reminder_queued_at=null;
 end if;
 if t.id is not null then update public.bos_push_deliveries set state='discarded',lease_token=null,locked_until=null where event_id=t.reminder_event and state in ('pending','sending'); end if;
 select * into t from bos_control_private.tasks where order_id=oid and issue_code=code;
 return jsonb_build_object('ok',true,'task',bos_control_private.task_view(t));
end $$;
revoke all on function public.bos_control_action(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.bos_control_action(uuid,text,jsonb) to service_role;

-- Resolve immediately on order changes, including short false/true transitions between cron ticks.
create or replace function bos_control_private.resolve_order() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update bos_control_private.tasks t set resolved_at=now(),updated_at=now(),version=version+1
 where t.order_id=new.id and t.resolved_at is null and not bos_control_private.current_task(t);
 return new;
end $$;
drop trigger if exists bos_control_resolve on public.orders;
create trigger bos_control_resolve after update on public.orders for each row execute function bos_control_private.resolve_order();

alter table public.bos_push_deliveries drop constraint if exists bos_push_deliveries_event_type_check;
alter table public.bos_push_deliveries add constraint bos_push_deliveries_event_type_check check(event_type in ('assigned','unassigned','rescheduled','cancelled','report_rejected','new_order','report_pending','test','control_due'));
create or replace function bos_control_private.tick() returns void language plpgsql security definer set search_path='' as $$
declare t bos_control_private.tasks; n integer; queued boolean:=false;
begin
 update bos_control_private.tasks x set resolved_at=now(),updated_at=now(),version=version+1 where x.resolved_at is null and not bos_control_private.current_task(x);
 if not exists(select 1 from bos_control_private.runtime where enabled) or not exists(select 1 from bos_push_private.runtime where enabled) then return; end if;
 for t in select * from bos_control_private.tasks where resolved_at is null and remind and reminder_queued_at is null and due_at<=now() and due_at>now()-interval '24 hours' order by due_at,id for update skip locked limit 100 loop
  if not bos_control_private.current_task(t) then continue; end if;
  insert into public.bos_push_deliveries(event_id,subscription_id,binding_id,event_type,order_id,expires_at)
   select t.reminder_event,s.id,s.binding_id,'control_due',t.order_id,now()+interval '15 minutes'
    from public.bos_push_subscriptions s join public.business_staff b on b.id=s.staff_id and b.external_id=s.external_id and b.is_active
    where s.staff_id=t.assignee_id and s.active and s.expires_at>now()
   on conflict(event_id,subscription_id) do nothing;
  get diagnostics n=row_count;
  if n>0 then update bos_control_private.tasks set reminder_queued_at=now() where id=t.id;queued:=true; end if;
 end loop;
 if queued then perform bos_push_private.kick(); end if;
end $$;
revoke all on all functions in schema bos_control_private from public,anon,authenticated;
grant execute on all functions in schema bos_control_private to service_role;

-- Ordinary business push behavior is unchanged; control reminders get at most one network attempt.
create or replace function public.bos_push_claim()
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  update public.bos_push_deliveries set state='discarded',lease_token=null
    where state in ('pending','sending') and (expires_at<=now() or ((attempts>=5 or (event_type='control_due' and attempts>=1)) and coalesce(locked_until,'-infinity')<now()));
  with selected as (
    select id from public.bos_push_deliveries where expires_at>now() and attempts<5 and (event_type<>'control_due' or attempts=0) and
      ((state='pending' and next_attempt_at<=now()) or (state='sending' and locked_until<now()))
      order by created_at,id for update skip locked limit 12
  ), leased as (
    update public.bos_push_deliveries d set state='sending',attempts=attempts+1,
      locked_until=now()+interval '2 minutes',lease_token=gen_random_uuid()
    from selected where d.id=selected.id returning d.id,d.lease_token
  ) select coalesce(jsonb_agg(to_jsonb(leased)),'[]'::jsonb) into result from leased;
  return result;
end $$;
revoke all on function public.bos_push_claim() from public, anon, authenticated;
grant execute on function public.bos_push_claim() to service_role;

-- Recheck binding and live authorization immediately before every provider request.
create or replace function public.bos_push_delivery(p_id uuid,p_lease uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select jsonb_build_object('id',d.id,'event_id',d.event_id,'binding_id',d.binding_id,'event_type',d.event_type,
    'order_id',case when d.event_type='unassigned' then null else d.order_id::text end,
    'expires_at',d.expires_at,'endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth_key)
  from public.bos_push_deliveries d
  join public.bos_push_subscriptions s on s.id=d.subscription_id and s.binding_id=d.binding_id and s.active and s.expires_at>now()
  join public.business_staff b on b.id=s.staff_id and b.external_id=s.external_id and b.is_active
  left join public.orders o on o.id=d.order_id
  where d.id=p_id and d.lease_token=p_lease and d.state='sending' and d.locked_until>now() and d.expires_at>now()
    and exists(select 1 from bos_push_private.runtime where enabled)
    and ((d.event_type='control_due' and exists(select 1 from bos_control_private.tasks t where t.reminder_event=d.event_id and t.assignee_id=b.id and t.order_id=d.order_id and t.remind and t.due_at<=now() and bos_control_private.current_task(t)) and exists(select 1 from bos_control_private.runtime where enabled))
      or (d.event_type='test' and b.role in ('owner','manager','dispatcher','master'))
      or (o.id is not null and (
        (b.role in ('owner','manager','dispatcher') and (d.event_type='new_order' or (d.event_type='report_pending' and o.report_review_status='pending')))
        or (b.role='master' and ((d.event_type='unassigned' and o.master_staff_id is distinct from b.id)
          or (o.master_staff_id=b.id and (
            (d.event_type in ('assigned','rescheduled') and o.status::text not in ('Отменена','Выполнена'))
            or (d.event_type='cancelled' and o.status::text='Отменена')
            or (d.event_type='report_rejected' and o.report_review_status='rejected' and o.status::text<>'Отменена')
          ))))
      ))) limit 1;
$$;
revoke all on function public.bos_push_delivery(uuid,uuid) from public, anon, authenticated;
grant execute on function public.bos_push_delivery(uuid,uuid) to service_role;

create or replace function public.bos_push_finish(p_id uuid,p_lease uuid,p_status integer,p_retry boolean)
returns void language plpgsql security invoker set search_path='' as $$
declare d public.bos_push_deliveries;
begin
  select * into d from public.bos_push_deliveries where id=p_id and lease_token=p_lease and state='sending' for update;
  if d.id is null then return; end if;
  if p_status in (404,410) then
    update public.bos_push_subscriptions set active=false,updated_at=now()
      where id=d.subscription_id and binding_id=d.binding_id;
  end if;
  update public.bos_push_deliveries set
    state=case when p_status between 200 and 299 then 'sent'
      when p_retry and d.event_type<>'control_due' and attempts<5 and expires_at>now() then 'pending' else 'discarded' end,
    next_attempt_at=now()+least(300,30*power(2,greatest(attempts-1,0)))::integer*interval '1 second',
    locked_until=null,lease_token=null,last_http_status=p_status where id=d.id;
end $$;
revoke all on function public.bos_push_finish(uuid,uuid,integer,boolean) from public, anon, authenticated;
grant execute on function public.bos_push_finish(uuid,uuid,integer,boolean) to service_role;

