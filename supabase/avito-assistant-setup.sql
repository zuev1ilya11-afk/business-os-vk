-- Additive assistant infrastructure. Disabled until credentials and a consenting pilot are verified.
-- Apply using Supabase migration tooling; do not enable from this setup file.
create schema if not exists bos_avito_private;
revoke all on schema bos_avito_private from public,anon,authenticated;
grant usage on schema bos_avito_private to service_role;

create table if not exists bos_avito_private.runtime(
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 started_at timestamptz,
 worker_key text not null default replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),
 worker_url text,
 lease uuid,locked_until timestamptz,next_run_at timestamptz not null default '-infinity',
 page_offset integer not null default 0 check(page_offset between 0 and 10000),
 usage_day date not null default (now() at time zone 'Europe/Moscow')::date,
 ai_calls integer not null default 0,sends integer not null default 0,
 daily_limit integer not null default 200 check(daily_limit between 1 and 1000),
 last_run_at timestamptz,last_error text,health jsonb
);
insert into bos_avito_private.runtime(singleton) values(true) on conflict do nothing;
create table if not exists bos_avito_private.conversations(
 account_id text not null,chat_id text not null,
 state jsonb not null default '{"status":"active"}',
 updated_at timestamptz not null default now(),
 primary key(account_id,chat_id),
 check(length(account_id) between 1 and 30),check(chat_id ~ '^[A-Za-z0-9_:-]{1,200}$')
);
create table if not exists bos_avito_private.outbox(
 id uuid primary key default gen_random_uuid(),account_id text not null,chat_id text not null,input_id text not null,
 body text not null check(length(body) between 1 and 1000),
 status text not null default 'sending' check(status in ('sending','sent','uncertain')),
 message_id text,created_at timestamptz not null default now(),
 unique(account_id,chat_id,input_id),
 foreign key(account_id,chat_id) references bos_avito_private.conversations(account_id,chat_id)
);
alter table bos_avito_private.runtime enable row level security;
alter table bos_avito_private.conversations enable row level security;
alter table bos_avito_private.outbox enable row level security;
revoke all on all tables in schema bos_avito_private from public,anon,authenticated;
grant select,insert,update,delete on all tables in schema bos_avito_private to service_role;

create or replace function public.bos_avito_assistant(p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r bos_avito_private.runtime%rowtype; s jsonb; result jsonb; oid bigint; send_id uuid;
 account text:=p_data->>'account'; chat text:=p_data->>'chat'; lock_id uuid;
begin
 if p_action='runtime' then
  select * into r from bos_avito_private.runtime where singleton;
  return to_jsonb(r);
 end if;
 select * into r from bos_avito_private.runtime where singleton for update;
 if p_action='health' then
  update bos_avito_private.runtime set health=p_data->'health' where singleton;
  return '{"ok":true}';
 end if;
 if p_action='claim' then
  if not r.enabled or r.started_at is null or r.next_run_at>now() or r.locked_until>now() then return null; end if;
  lock_id:=gen_random_uuid();
  update bos_avito_private.runtime set lease=lock_id,locked_until=now()+interval '90 seconds',
   ai_calls=case when usage_day=(now() at time zone 'Europe/Moscow')::date then ai_calls else 0 end,
   sends=case when usage_day=(now() at time zone 'Europe/Moscow')::date then sends else 0 end,
   usage_day=(now() at time zone 'Europe/Moscow')::date where singleton;
  return jsonb_build_object('lease',lock_id,'started_at',r.started_at,'page_offset',r.page_offset);
 end if;
 if r.lease is null or r.lease::text is distinct from p_data->>'lease' or r.locked_until<=now() then raise exception 'STALE_LEASE'; end if;
 if p_action='release' then
  update bos_avito_private.runtime set lease=null,locked_until=null,last_run_at=now(),
   last_error=case when p_data->>'error' ~ '^[A-Z_]{1,60}$' then p_data->>'error' else null end,
   next_run_at=now()+make_interval(secs=>least(3600,greatest(0,coalesce((p_data->>'retry_after')::integer,0)))),
   page_offset=least(10000,greatest(0,coalesce((p_data->>'offset')::integer,0))) where singleton;
  return '{"ok":true}';
 end if;
 if not r.enabled then raise exception 'ASSISTANT_DISABLED'; end if;
 if p_action='budget' then
  if r.ai_calls>=r.daily_limit then return 'false'; end if;
  update bos_avito_private.runtime set ai_calls=ai_calls+1 where singleton;return 'true';
 end if;
 if not exists(select 1 from public.avito_connections where id=1 and is_active and avito_user_id::text=account) then raise exception 'ACCOUNT_CHANGED'; end if;
 if coalesce(chat,'') !~ '^[A-Za-z0-9_:-]{1,200}$' then raise exception 'INVALID_CHAT'; end if;
 if p_action='load' then
  insert into bos_avito_private.conversations(account_id,chat_id) values(account,chat) on conflict do nothing;
  select state into s from bos_avito_private.conversations where account_id=account and chat_id=chat;
  select jsonb_build_object('state',s,
   'bot_ids',coalesce(jsonb_agg(message_id) filter(where status='sent' and message_id is not null),'[]'),
   'uncertain',coalesce(bool_or(status in ('sending','uncertain')),false),
   'sent_count',count(*)) into result from bos_avito_private.outbox where account_id=account and chat_id=chat;
  return result;
 end if;
 select state into s from bos_avito_private.conversations where account_id=account and chat_id=chat for update;
 if s is null then raise exception 'MISSING_STATE'; end if;
 if p_action='save' then
  if p_data->'state'->>'status' not in ('active','awaiting_confirmation','confirmed','handoff','paused') then raise exception 'INVALID_STATE'; end if;
  update bos_avito_private.conversations set state=p_data->'state',updated_at=now() where account_id=account and chat_id=chat;
  return '{"ok":true}';
 end if;
 if p_action='reserve_send' then
  if r.sends>=r.daily_limit then return null; end if;
  insert into bos_avito_private.outbox(account_id,chat_id,input_id,body)
   values(account,chat,p_data->>'input_id',p_data->>'body')
   on conflict(account_id,chat_id,input_id) do nothing returning id into send_id;
  if send_id is null then return null; end if;
  update bos_avito_private.runtime set sends=sends+1 where singleton;
  return to_jsonb(send_id);
 end if;
 if p_action='finish_send' then
  update bos_avito_private.outbox set status=case when nullif(p_data->>'message_id','') is not null then 'sent' else 'uncertain' end,
   message_id=nullif(p_data->>'message_id','')
   where id=(p_data->>'id')::uuid and account_id=account and chat_id=chat and status='sending';
  return '{"ok":true}';
 end if;
 if p_action='create_order' then
  if s->>'status'<>'awaiting_confirmation' or nullif(s->>'summary_message_id','') is null or nullif(s->>'summary','') is null then raise exception 'CONFIRMATION_REQUIRED'; end if;
  if coalesce(s->'fields'->>'name','')='' or coalesce(s->'fields'->>'address','')='' or coalesce(s->'fields'->>'work','')='' or
   coalesce(s->'fields'->>'phone','') !~ '^\+7[0-9]{10}$' or coalesce(s->'fields'->>'region','') not in ('Санкт-Петербург','Ленинградская область') then raise exception 'INCOMPLETE_ORDER'; end if;
  insert into public.orders(client,phone,address,work,city,status,source,external_source,external_id,
   avito_chat_id,avito_item_id,avito_item_url,comment,amount,original_amount,master_payout,manager_payout,dispatcher_payout,
   master_staff_id,master_id,scheduled_date,scheduled_time,sync_status,source_updated_at)
  values(s->'fields'->>'name',s->'fields'->>'phone',
   (s->'fields'->>'settlement')||', '||(s->'fields'->>'address'),s->'fields'->>'work',s->'fields'->>'region',
   'Новая','Авито','avito','avito_chat_'||chat,chat,left(p_data->>'item_id',200),
   case when p_data->>'item_url' ~ '^https://([a-z0-9-]+\.)?avito\.ru/' then left(p_data->>'item_url',2000) else null end,
   'Собрано ИИ-помощником Авито. Клиент подтвердил передачу заявки. Итоговая стоимость и время выезда требуют согласования.'||E'\n'||(s->>'summary'),
   0,0,0,0,0,null,null,null,null,'pending_sheet',now())
   on conflict(external_source,external_id) where external_id is not null do nothing returning id into oid;
  if oid is null then select id into oid from public.orders where external_source='avito' and external_id='avito_chat_'||chat; end if;
  update bos_avito_private.conversations set state=state||jsonb_build_object('status','confirmed','order_id',oid),updated_at=now()
   where account_id=account and chat_id=chat;
  return to_jsonb(oid);
 end if;
 raise exception 'UNKNOWN_ACTION';
end $$;
revoke all on function public.bos_avito_assistant(text,jsonb) from public,anon,authenticated;
grant execute on function public.bos_avito_assistant(text,jsonb) to service_role;

create or replace function bos_avito_private.kick(p_probe boolean default false)
returns bigint language plpgsql security invoker set search_path='' as $$
declare r bos_avito_private.runtime%rowtype; request_id bigint;
begin
 select * into r from bos_avito_private.runtime where singleton;
 if r.worker_url is null or (not p_probe and (not r.enabled or r.next_run_at>now() or r.locked_until>now())) then return null; end if;
 if r.worker_url !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/avito-assistant-api$' then raise exception 'INVALID_WORKER_URL'; end if;
 select net.http_post(url:=r.worker_url,
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||r.worker_key),
  body:=jsonb_build_object('action',case when p_probe then 'probe' else 'worker' end),
  timeout_milliseconds:=60000) into request_id;
 return request_id;
end $$;
revoke all on function bos_avito_private.kick(boolean) from public,anon,authenticated;
grant execute on function bos_avito_private.kick(boolean) to service_role;
