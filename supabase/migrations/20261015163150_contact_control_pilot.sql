-- Extend the existing contact journal and control queue. No activation/backfill.
alter table public.orders add column if not exists master_contact_revision bigint not null default 0,
 add column if not exists master_contact_control_active boolean not null default false;
alter table public.orders drop constraint if exists orders_master_contact_status_check;
alter table public.orders add constraint orders_master_contact_status_check check(master_contact_status is null or master_contact_status in
 ('pending','no_answer','thinking','waiting_delivery','call_later','agreed','other','needs_help','client_declined'));
alter table bos_control_private.tasks drop constraint if exists tasks_issue_code_check;
alter table bos_control_private.tasks add constraint tasks_issue_code_check check(issue_code in
 ('reschedule','overdue','unassigned','undated','untimed','agreement','report_review','report_rejected','unfinished_work','contact_first','contact_followup','contact_help','contact_declined'));
alter table bos_control_private.tasks add column if not exists contact_revision bigint,
 add column if not exists contact_master_id uuid references public.business_staff(id),
 add column if not exists contact_manager_id uuid references public.business_staff(id),
 add column if not exists reminded_at timestamptz,add column if not exists escalated_at timestamptz,
 add column if not exists escalation_due_at timestamptz,add column if not exists contact_audit jsonb not null default '[]';
create table if not exists bos_control_private.contact_config(
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 reminders_enabled boolean not null default false,pilot_staff_ids uuid[] not null default '{}',
 manager_id uuid references public.business_staff(id),first_contact_minutes integer not null default 60 check(first_contact_minutes between 1 and 1440),
 escalation_minutes integer not null default 120 check(escalation_minutes between 1 and 10080),
 reminder_limit integer not null default 1 check(reminder_limit between 0 and 1),
 company_start time,company_end time,company_days integer[],time_zone text not null default 'Europe/Moscow' check(time_zone='Europe/Moscow'),
 check(company_end>company_start),check(company_days<@array[1,2,3,4,5,6,7])
);
insert into bos_control_private.contact_config(singleton) values(true) on conflict do nothing;
alter table bos_control_private.contact_config enable row level security;
revoke all on bos_control_private.contact_config from public,anon,authenticated;
grant all on bos_control_private.contact_config to service_role;
create or replace function bos_control_private.contact_config_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if new.enabled and (new.company_start is null or new.company_end is null or coalesce(cardinality(new.company_days),0)=0
  or cardinality(new.pilot_staff_ids)=0 or not exists(select 1 from public.business_staff where id=new.manager_id and is_active and role in ('owner','manager')))
 then raise exception 'CONTACT_CONFIG_REQUIRED: company work window, pilot masters and responsible manager'; end if;
 return new;
end $$;
drop trigger if exists contact_config_guard on bos_control_private.contact_config;
create trigger contact_config_guard before insert or update on bos_control_private.contact_config for each row execute function bos_control_private.contact_config_guard();

-- Business minutes in the existing per-date staff schedule; missing days use explicit company hours.
-- Only a recorded departure/start and an explicit visit interval can defer first-contact time.
create or replace function bos_control_private.contact_due(p_master uuid,p_start timestamptz,p_minutes integer) returns timestamptz
language plpgsql stable set search_path='' as $$
declare cfg bos_control_private.contact_config; day date; row_schedule jsonb; a timestamptz; z timestamptz; cursor_at timestamptz:=p_start;
 remaining numeric:=p_minutes*60; available numeric; i integer; blocked_until timestamptz;
begin
 select * into cfg from bos_control_private.contact_config where singleton;
 if cfg.company_start is null or cfg.company_end is null or coalesce(cardinality(cfg.company_days),0)=0 then raise exception 'CONTACT_WORK_WINDOW_REQUIRED'; end if;
 select max((o.scheduled_date::date+parts[2]::time) at time zone cfg.time_zone)
 into blocked_until from public.orders o cross join lateral regexp_match(o.time_slot,
  '^\s*((?:[01]?[0-9]|2[0-3]):[0-5][0-9])\s*[–—-]\s*((?:[01]?[0-9]|2[0-3]):[0-5][0-9]|24:00)\s*$') parts
 where o.master_staff_id=p_master and o.status::text not in ('Выполнена','Отменена')
 and o.report_uploaded_at is null and (o.master_started_at is not null or o.master_departed_at is not null)
 and o.scheduled_date::text=((p_start at time zone cfg.time_zone)::date)::text and parts[2]::time>parts[1]::time;
 cursor_at:=greatest(cursor_at,blocked_until);
 for i in 0..366 loop
  day:=(cursor_at at time zone cfg.time_zone)::date;
  select to_jsonb(s) into row_schedule from public.staff_schedule s where s.staff_id=p_master and s.work_date=day;
  if row_schedule is not null then
   if (row_schedule->>'is_working')::boolean and row_schedule->>'work_start' is not null and row_schedule->>'work_end' is not null then
    a:=(day+(row_schedule->>'work_start')::time) at time zone cfg.time_zone;
    z:=(day+(row_schedule->>'work_end')::time) at time zone cfg.time_zone;
   else a:=null;z:=null; end if;
  elsif extract(isodow from day)::integer=any(cfg.company_days) then
   a:=(day+cfg.company_start) at time zone cfg.time_zone;z:=(day+cfg.company_end) at time zone cfg.time_zone;
  else a:=null;z:=null; end if;
  if a is not null and z>greatest(a,cursor_at) then
   cursor_at:=greatest(a,cursor_at);available:=extract(epoch from(z-cursor_at));
   if remaining<=available then return cursor_at+remaining*interval '1 second'; end if;
   remaining:=remaining-available;
  end if;
  cursor_at:=((day+1)::timestamp at time zone cfg.time_zone);
 end loop;
 raise exception 'CONTACT_NO_WORKING_TIME_WITHIN_YEAR';
end $$;

-- Keep previous functions intact for manual tasks; wrappers are migration-retry safe.
do $$ begin
 if to_regprocedure('bos_control_private.current_task_before_contact(bos_control_private.tasks)') is null then
  alter function bos_control_private.current_task(bos_control_private.tasks) rename to current_task_before_contact;
  alter function bos_control_private.task_view(bos_control_private.tasks) rename to task_view_before_contact;
  alter function public.bos_control_action(uuid,text,jsonb) rename to bos_control_action_before_contact;
 end if;
end $$;
create or replace function bos_control_private.current_task(t bos_control_private.tasks) returns boolean language sql stable set search_path='' as $$
 select case when t.contact_revision is null then bos_control_private.current_task_before_contact(t) else
  t.resolved_at is null and exists(select 1 from public.orders o where o.id=t.order_id and o.master_contact_control_active
   and o.status::text not in ('Выполнена','Отменена') and o.master_contact_revision=t.contact_revision
   and o.master_staff_id is not distinct from t.contact_master_id) end;
$$;
create or replace function bos_control_private.task_view(t bos_control_private.tasks) returns jsonb language sql stable set search_path='' as $$
 select bos_control_private.task_view_before_contact(t)||case when t.contact_revision is null then '{}'::jsonb else jsonb_build_object(
 'automatic',true,'active',bos_control_private.current_task(t),'contact_revision',t.contact_revision,'reminded_at',t.reminded_at,
 'escalated_at',t.escalated_at,'manager_id',t.contact_manager_id,'manager_name',(select full_name from public.business_staff where id=t.contact_manager_id),
 'needs_manager',t.escalated_at is not null or t.issue_code in ('contact_help','contact_declined'),
 'reminder_status',case when exists(select 1 from bos_control_private.contact_config where enabled and reminders_enabled and reminder_limit>0) then
  case when exists(select 1 from public.bos_push_deliveries d where d.event_id=t.reminder_event and d.state='sent') then 'accepted'
   when exists(select 1 from public.bos_push_deliveries d where d.event_id=t.reminder_event and d.state in ('pending','sending')) then 'queued'
   when t.reminded_at is not null then 'not_delivered' else 'scheduled' end else 'off' end) end;
$$;
create or replace function public.bos_control_action(p_actor uuid,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql set search_path='' as $$
begin
 if p_action in ('controlSave','controlClear') and coalesce(p_input->>'issue_code','') like 'contact_%' then
  return jsonb_build_object('ok',false,'status',409,'error','Обновите итог связи в карточке заявки. Автоматическое поручение изменится вместе с ним.'); end if;
 return public.bos_control_action_before_contact(p_actor,p_action,p_input);
end $$;

-- New contact metadata is server-owned. External agreement/assignment changes invalidate stale forms.
create or replace function bos_control_private.contact_revision_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user<>'service_role' and (new.master_contact_revision is distinct from case when tg_op='UPDATE' then old.master_contact_revision else 0 end
  or new.master_contact_control_active is distinct from case when tg_op='UPDATE' then old.master_contact_control_active else false end) then
  raise exception 'CONTACT_CONTROL_SERVER_ONLY' using errcode='42501'; end if;
 if tg_op='UPDATE' and old.master_contact_control_active and new.master_contact_revision=old.master_contact_revision and
 (new.master_staff_id is distinct from old.master_staff_id or new.scheduled_date is distinct from old.scheduled_date
  or new.scheduled_time is distinct from old.scheduled_time or new.master_agreed_at is distinct from old.master_agreed_at
  or new.reschedule_requested is distinct from old.reschedule_requested or new.master_contact_updated_at is distinct from old.master_contact_updated_at) then new.master_contact_revision:=old.master_contact_revision+1; end if;
 return new;
end $$;
drop trigger if exists z_bos_contact_revision on public.orders;
create trigger z_bos_contact_revision before insert or update on public.orders for each row execute function bos_control_private.contact_revision_guard();

create or replace function bos_control_private.contact_sync_order() returns trigger language plpgsql security definer set search_path='' as $$
declare cfg bos_control_private.contact_config; t bos_control_private.tasks; code text; due timestamptz; person uuid; assigned boolean;
 changed_result boolean; current_revision bigint;
begin
 select * into cfg from bos_control_private.contact_config where singleton;
 assigned:=tg_op='INSERT' or new.master_staff_id is distinct from old.master_staff_id;
 select * into t from bos_control_private.tasks where order_id=new.id and contact_revision is not null and resolved_at is null for update;
 if new.status::text in ('Выполнена','Отменена') then
  update bos_control_private.tasks set resolved_at=now(),version=version+1 where order_id=new.id and contact_revision is not null and resolved_at is null;
  update public.bos_push_deliveries set state='discarded',lease_token=null,locked_until=null where event_id=t.reminder_event and state in ('pending','sending');return new;
 end if;
 if t.id is not null and assigned then
  update public.bos_push_deliveries set state='discarded',lease_token=null,locked_until=null where event_id=t.reminder_event and state in ('pending','sending');
  update bos_control_private.tasks set contact_master_id=new.master_staff_id,contact_revision=new.master_contact_revision,
   assignee_id=case when issue_code in ('contact_help','contact_declined') or new.master_staff_id is null then contact_manager_id else new.master_staff_id end,
   version=version+1,updated_at=now(),reminder_event=gen_random_uuid(),reminder_queued_at=null,reminded_at=null,
   contact_audit=contact_audit||jsonb_build_array(jsonb_build_object('event','reassigned','at',now(),'from',t.contact_master_id,'to',new.master_staff_id,'due_at',due_at)) where id=t.id;
  return new;
 end if;
 changed_result:=tg_op='UPDATE' and new.master_contact_revision<>old.master_contact_revision and new.master_contact_updated_at is distinct from old.master_contact_updated_at;
 if not cfg.enabled or (not coalesce(new.master_staff_id=any(cfg.pilot_staff_ids),false) and t.id is null) then
  if changed_result and t.id is not null then
   update bos_control_private.tasks set resolved_at=now(),version=version+1,
    contact_audit=contact_audit||jsonb_build_array(jsonb_build_object('event','contact_saved_outside_pilot','at',now())) where id=t.id;
   update public.bos_push_deliveries set state='discarded',lease_token=null,locked_until=null where event_id=t.reminder_event and state in ('pending','sending');
  end if;return new;
 end if;
 if not changed_result and t.id is not null then
  if new.master_agreed_at is distinct from old.master_agreed_at and new.master_agreed_at is not null and not coalesce(new.reschedule_requested,false) then
   update bos_control_private.tasks set resolved_at=now(),version=version+1 where id=t.id;
  elsif t.contact_revision<>new.master_contact_revision then
   update bos_control_private.tasks set contact_revision=new.master_contact_revision,version=version+1 where id=t.id;
  end if;return new;
 end if;
 if not coalesce(new.master_staff_id=any(cfg.pilot_staff_ids),false) and t.id is null then return new; end if;
 if changed_result then
  update public.bos_push_deliveries set state='discarded',lease_token=null,locked_until=null where event_id=t.reminder_event and state in ('pending','sending');
  update bos_control_private.tasks set resolved_at=now(),version=version+1 where order_id=new.id and contact_revision is not null and resolved_at is null;
  if new.master_contact_status='agreed' then return new; end if;
  code:=case new.master_contact_status when 'needs_help' then 'contact_help' when 'client_declined' then 'contact_declined' else 'contact_followup' end;
  due:=case when code='contact_followup' then new.master_contact_callback_at else now() end;
 elsif assigned and new.master_staff_id is not null then
  -- Only a genuine new assignment after activation. Never scan/adopt historical rows.
  code:='contact_first';due:=bos_control_private.contact_due(new.master_staff_id,now(),cfg.first_contact_minutes);
 else return new; end if;
 if due is null then return new; end if;
 person:=case when code in ('contact_help','contact_declined') then cfg.manager_id else new.master_staff_id end;
 -- Assignment enrollment is done by the BEFORE trigger below; no recursive order update.
 current_revision:=new.master_contact_revision;
 insert into bos_control_private.tasks(order_id,issue_code,assignee_id,due_at,remind,updated_by,contact_revision,contact_master_id,contact_manager_id,escalation_due_at,contact_audit)
 values(new.id,code,person,due,false,person,current_revision,new.master_staff_id,cfg.manager_id,
  bos_control_private.contact_due(new.master_staff_id,due,cfg.escalation_minutes),jsonb_build_array(jsonb_build_object('event','opened','at',now(),'due_at',due,'revision',current_revision)))
 on conflict(order_id,issue_code) do update set assignee_id=excluded.assignee_id,due_at=excluded.due_at,resolved_at=null,version=bos_control_private.tasks.version+1,
  contact_revision=excluded.contact_revision,contact_master_id=excluded.contact_master_id,contact_manager_id=excluded.contact_manager_id,
  escalation_due_at=excluded.escalation_due_at,escalated_at=null,reminded_at=null,reminder_event=gen_random_uuid(),reminder_queued_at=null,
  updated_at=now(),updated_by=excluded.updated_by,contact_audit=bos_control_private.tasks.contact_audit||excluded.contact_audit;
 return new;
end $$;
create or replace function bos_control_private.contact_enroll_assignment() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (tg_op='INSERT' or new.master_staff_id is distinct from old.master_staff_id) and exists(select 1 from bos_control_private.contact_config c where c.enabled and new.master_staff_id=any(c.pilot_staff_ids)) then
  new.master_contact_control_active:=true;
 end if;return new;
end $$;
drop trigger if exists zz_bos_contact_enroll on public.orders;
create trigger zz_bos_contact_enroll before insert or update on public.orders for each row execute function bos_control_private.contact_enroll_assignment();
-- Before the existing resolve trigger: transfer responsibility before it evaluates current_task.
drop trigger if exists bos_contact_sync on public.orders;
create trigger bos_contact_sync after insert or update on public.orders for each row execute function bos_control_private.contact_sync_order();

create or replace function public.bos_contact_action(p_actor uuid,p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor public.business_staff; o public.orders; cfg bos_control_private.contact_config; entry jsonb; existing jsonb;
 result text:=p_input->>'result'; event_id text:=p_input->>'attempt_id'; contact_phone text:=p_input->>'phone'; note text:=btrim(coalesce(p_input->>'comment',''));
 callback timestamptz; visit date; visit_time time; slot text; minutes integer; first_time text; last_time text; slot_parts text[]; v bigint;
 now_at timestamptz:=clock_timestamp(); enrolled boolean; payload jsonb;
begin
 select * into actor from public.business_staff where id=p_actor and is_active;
 if actor.id is null or actor.role not in ('master','owner','manager','dispatcher') then return jsonb_build_object('ok',false,'status',403,'error','Недостаточно прав.'); end if;
 if coalesce(p_input->>'id','') !~ '^\d{1,18}$' then return jsonb_build_object('ok',false,'status',400,'error','Некорректная заявка.'); end if;
 select * into o from public.orders where id=(p_input->>'id')::bigint for update;
 if o.id is null then return jsonb_build_object('ok',false,'status',404,'error','Заявка не найдена.'); end if;
 if actor.role='master' and o.master_staff_id is distinct from actor.id then return jsonb_build_object('ok',false,'status',403,'error','Можно менять только свою заявку.'); end if;
 select * into cfg from bos_control_private.contact_config where singleton;
 enrolled:=cfg.enabled and (coalesce(o.master_staff_id=any(cfg.pilot_staff_ids),false) or exists(select 1 from bos_control_private.tasks where order_id=o.id and contact_revision is not null and resolved_at is null));
 if p_action='contactPolicy' then return jsonb_build_object('ok',true,'enabled',enrolled,'revision',o.master_contact_revision,'time_zone',cfg.time_zone); end if;
 if not enrolled then
  if p_input->>'contact_control'='true' then return jsonb_build_object('ok',false,'status',409,'error','Правила пилота изменились. Откройте заявку заново.'); end if;
  return jsonb_build_object('handled',false);
 end if;
 if o.status::text in ('Выполнена','Отменена') then return jsonb_build_object('ok',false,'status',409,'error','Заявка закрыта.'); end if;
 if p_action not in ('recordContactAttempt','recordContactResult') then
  return jsonb_build_object('ok',false,'status',409,'error','Обновите итог связи с датой и временем через карточку заявки.'); end if;
 if coalesce(event_id,'') !~ '^[A-Za-z0-9_-]{8,96}$' or coalesce(contact_phone,'') !~ '^\+[0-9]{10,15}$' then return jsonb_build_object('ok',false,'status',400,'error','Некорректная попытка связи.'); end if;
 -- Exact normalized phones are additionally verified by the existing endpoint before RPC.
 if not exists(select 1 from regexp_matches(coalesce(o.phone,''),'(?:\+?7|8)?[\s(.-]*[0-9]{3}[\s).-]*[0-9]{3}[\s.-]*[0-9]{2}[\s.-]*[0-9]{2}','g') h
  where '+7'||right(regexp_replace(h[1],'\D','','g'),10)=contact_phone) and '+'||regexp_replace(coalesce(o.phone,''),'\D','','g')<>contact_phone then return jsonb_build_object('ok',false,'status',400,'error','Номер не относится к этой заявке.'); end if;
 if p_action='recordContactAttempt' then
  event_id:=event_id||':attempt';
  select x into existing from jsonb_array_elements(o.master_contact_history) x where x->>'id'=event_id;
  if existing is not null then return jsonb_build_object('ok',true,'order',to_jsonb(o),'idempotent',true); end if;
  entry:=jsonb_build_object('id',event_id,'at',now_at,'phone',contact_phone,'result','pending','by_staff_id',actor.id,'by_name',actor.full_name);
  update public.orders set master_contact_history=master_contact_history||jsonb_build_array(entry),updated_at=now_at where id=o.id returning * into o;
  return jsonb_build_object('ok',true,'order',to_jsonb(o));
 end if;
 if result is null or result not in ('no_answer','thinking','waiting_delivery','call_later','agreed','other','needs_help','client_declined') or length(note)>500 then
  return jsonb_build_object('ok',false,'status',400,'error','Некорректный итог связи или слишком длинный комментарий.'); end if;
 if result in ('needs_help','client_declined','other') and note='' then return jsonb_build_object('ok',false,'status',400,'error','Укажите причину.'); end if;
 begin
  if result in ('no_answer','thinking','waiting_delivery','call_later','other') then
   if coalesce(p_input->>'callback_at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$' then raise invalid_parameter_value; end if;
   callback:=(p_input->>'callback_at')::timestamptz;
  elsif result='agreed' then
   if coalesce(p_input->>'scheduled_date','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_input->>'scheduled_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise invalid_parameter_value; end if;
   visit:=(p_input->>'scheduled_date')::date;visit_time:=(p_input->>'scheduled_time')::time;
  end if;
  if coalesce(p_input->>'expected_revision','') !~ '^\d{1,15}$' then raise invalid_parameter_value; end if;
  v:=(p_input->>'expected_revision')::bigint;
 exception when others then return jsonb_build_object('ok',false,'status',400,'error','Укажите обязательные дату и время. Обновите устаревшую карточку.'); end;
 payload:=jsonb_build_object('result',result,'comment',note,'phone',contact_phone,'callback_at',callback,'scheduled_date',visit,'scheduled_time',to_char(visit_time,'HH24:MI'));
 select x into existing from jsonb_array_elements(o.master_contact_history) x where x->>'id'=event_id;
 if existing is not null then
  if existing->'request'=payload and existing->>'by_staff_id'=actor.id::text then return jsonb_build_object('ok',true,'order',to_jsonb(o),'idempotent',true); end if;
  return jsonb_build_object('ok',false,'status',409,'error','Эта попытка уже сохранена с другим результатом. Откройте новый итог.');
 end if;
 if o.master_contact_revision<>v then return jsonb_build_object('ok',false,'status',409,'error','Договорённость уже изменена. Обновите заявку; черновик сохранён.'); end if;
 if callback is not null and (callback<=now_at or callback>now_at+interval '365 days') then return jsonb_build_object('ok',false,'status',400,'error','Укажите следующий контакт в будущем, не дальше года.'); end if;
 if result='agreed' then
  if o.master_started_at is not null or o.report_act_url is not null or o.report_uploaded_at is not null then return jsonb_build_object('ok',false,'status',409,'error','После начала работы договорённость менять нельзя.'); end if;
  if (visit+visit_time) at time zone cfg.time_zone<=now_at then return jsonb_build_object('ok',false,'status',400,'error','Укажите будущие дату и время визита.'); end if;
  -- Shift the existing interval, retaining its duration. With no trustworthy interval keep it unchanged.
  slot:=o.time_slot;slot_parts:=regexp_match(slot,'^\s*((?:[01]?[0-9]|2[0-3]):[0-5][0-9])\s*[–—-]\s*((?:[01]?[0-9]|2[0-3]):[0-5][0-9]|24:00)\s*$');
  if slot_parts is not null and slot_parts[1]::time<'24:00'::time and slot_parts[2]::time>slot_parts[1]::time then
   minutes:=extract(epoch from(slot_parts[2]::time-slot_parts[1]::time))/60;
   if extract(epoch from visit_time)/60+minutes>1440 then return jsonb_build_object('ok',false,'status',400,'error','Визит с текущей длительностью выходит за границы суток.'); end if;
   slot:=to_char(visit_time,'HH24:MI')||'–'||case when extract(epoch from visit_time)/60+minutes=1440 then '24:00' else to_char(visit_time+minutes*interval '1 minute','HH24:MI') end;
  end if;
 end if;
 if result='agreed' then o:=jsonb_populate_record(o,jsonb_build_object('scheduled_date',visit,'scheduled_time',to_char(visit_time,'HH24:MI'))); end if;
 entry:=payload||jsonb_build_object('id',event_id,'at',now_at,'result_at',now_at,'by_staff_id',actor.id,'by_name',actor.full_name,'request',payload);
 update public.orders set master_contact_history=master_contact_history||jsonb_build_array(entry),master_contact_status=result,
  master_contact_comment=nullif(note,''),master_contact_phone=contact_phone,master_contact_updated_at=now_at,master_contact_callback_at=callback,
  master_contact_revision=master_contact_revision+1,master_contact_control_active=true,
  scheduled_date=o.scheduled_date,scheduled_time=o.scheduled_time,
  time_slot=case when result='agreed' then slot else time_slot end,master_agreed_at=case when result='agreed' then now_at else master_agreed_at end,
  master_called_at=case when actor.role='master' and result in ('thinking','waiting_delivery','call_later','agreed','client_declined') and master_called_by_staff_id is null then now_at else master_called_at end,
  master_called_by_staff_id=case when actor.role='master' and result in ('thinking','waiting_delivery','call_later','agreed','client_declined') and master_called_by_staff_id is null then actor.id else master_called_by_staff_id end,
  master_called_by_name=case when actor.role='master' and result in ('thinking','waiting_delivery','call_later','agreed','client_declined') and master_called_by_staff_id is null then actor.full_name else master_called_by_name end,
  updated_at=now_at,sync_status='pending_sheet' where id=o.id returning * into o;
 return jsonb_build_object('ok',true,'order',to_jsonb(o));
end $$;

-- Durable in-app stages are independent of Web Push. One attempt per recipient/version (cap 0/1).
create or replace function bos_control_private.contact_tick() returns void language plpgsql security definer set search_path='' as $$
declare cfg bos_control_private.contact_config; o public.orders; t bos_control_private.tasks; recipient uuid; targets uuid[]; queued boolean:=false;
begin
 select * into cfg from bos_control_private.contact_config where singleton;
 if not cfg.enabled or not cfg.reminders_enabled then return; end if;
 -- Same order -> task lock order as contact writes/assignment; no task-first deadlocks.
 for o in select x.* from public.orders x where exists(select 1 from bos_control_private.tasks y where y.order_id=x.id and y.contact_revision is not null and y.resolved_at is null and y.due_at<=now()
 and bos_control_private.current_task(y)
 and (y.reminded_at is null or (y.escalated_at is null and y.escalation_due_at<=now() and y.issue_code in ('contact_first','contact_followup'))))
 order by x.id for update skip locked limit 200 loop
  for t in select * from bos_control_private.tasks where order_id=o.id and contact_revision is not null and resolved_at is null for update loop
   if not bos_control_private.current_task(t) then continue; end if;
   targets:='{}';
   if t.reminded_at is null then
    update bos_control_private.tasks set reminded_at=now() where id=t.id;targets:=array_append(targets,t.assignee_id);
   elsif t.escalated_at is null and t.escalation_due_at<=now() and t.issue_code in ('contact_first','contact_followup') then
    update bos_control_private.tasks set escalated_at=now() where id=t.id;targets:=array_append(targets,t.contact_manager_id);
   end if;
   if cfg.reminder_limit=0 or not exists(select 1 from bos_push_private.runtime where enabled) then continue; end if;
   foreach recipient in array targets loop
    insert into public.bos_push_deliveries(event_id,subscription_id,binding_id,event_type,order_id,expires_at)
     select t.reminder_event,s.id,s.binding_id,'control_due',t.order_id,now()+interval '15 minutes' from public.bos_push_subscriptions s
     join public.business_staff b on b.id=s.staff_id and b.external_id=s.external_id and b.is_active
     where s.staff_id=recipient and s.active and s.expires_at>now() on conflict(event_id,subscription_id) do nothing;
    if found then queued:=true; end if;
   end loop;
  end loop;
 end loop;
 if queued then perform bos_push_private.kick(); end if;
end $$;

revoke all on all functions in schema bos_control_private from public,anon,authenticated;
grant execute on all functions in schema bos_control_private to service_role;
revoke all on function public.bos_contact_action(uuid,text,jsonb),public.bos_control_action(uuid,text,jsonb),public.bos_control_action_before_contact(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.bos_contact_action(uuid,text,jsonb),public.bos_control_action(uuid,text,jsonb) to service_role;

-- Existing scheduled control tick now also advances pilot tasks, independently of push.
create or replace function bos_control_private.tick() returns void language plpgsql security definer set search_path='' as $$
declare t bos_control_private.tasks; n integer; queued boolean:=false;
begin
 perform bos_control_private.contact_tick();
 update bos_control_private.tasks x set resolved_at=now(),updated_at=now(),version=version+1 where x.resolved_at is null and not bos_control_private.current_task(x);
 if not exists(select 1 from bos_control_private.runtime where enabled) or not exists(select 1 from bos_push_private.runtime where enabled) then return; end if;
 for t in select * from bos_control_private.tasks where contact_revision is null and resolved_at is null and remind and reminder_queued_at is null and due_at<=now() and due_at>now()-interval '24 hours' order by due_at,id for update skip locked limit 100 loop
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

-- Recheck the same live task/version/recipient and pilot kill switch immediately before delivery.
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
    and ((d.event_type='control_due' and exists(select 1 from bos_control_private.tasks t where t.reminder_event=d.event_id and t.order_id=d.order_id and t.due_at<=now() and bos_control_private.current_task(t)
       and ((t.contact_revision is null and t.assignee_id=b.id and t.remind and exists(select 1 from bos_control_private.runtime where enabled))
        or (t.contact_revision is not null and exists(select 1 from bos_control_private.contact_config c where c.enabled and c.reminders_enabled and c.reminder_limit>0)
         and ((t.assignee_id=b.id and t.reminded_at is not null) or (t.contact_manager_id=b.id and t.escalated_at is not null))))))
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
