-- Durable outbox for NEW accepted Hands reports. No backfill and no financial writes.
-- Deploy the worker, verify the provider contract, then enable with hands-report-activation.sql.
create schema if not exists bos_hands_private;
revoke all on schema bos_hands_private from public, anon, authenticated;
grant usage on schema bos_hands_private to service_role;

create table if not exists bos_hands_private.runtime (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  worker_secret_id uuid not null,
  worker_url text,
  next_kick_at timestamptz not null default '-infinity'
);
alter table bos_hands_private.runtime enable row level security;
revoke all on bos_hands_private.runtime from public, anon, authenticated;
grant all on bos_hands_private.runtime to service_role;
do $$ begin
  if not exists(select 1 from bos_hands_private.runtime) then
    insert into bos_hands_private.runtime(worker_secret_id) values
      (vault.create_secret(replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),'bos-hands-report-worker-v1'));
  end if;
end $$;

create table if not exists bos_hands_private.deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id bigint not null references public.orders(id) on delete cascade,
  report_token text not null,
  snapshot jsonb not null,
  state text not null default 'queued' check(state in ('queued','processing','retry','sent','attention','cancelled')),
  step integer not null default 0 check(step>=0),
  step_label text,
  final_step boolean not null default false,
  inflight boolean not null default false,
  uncertain boolean not null default false,
  failures integer not null default 0,
  error text,
  lease uuid,
  locked_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  version uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique(order_id,report_token)
);
create index if not exists bos_hands_deliveries_pending on bos_hands_private.deliveries(next_attempt_at)
  where state in ('queued','retry','processing');
alter table bos_hands_private.deliveries enable row level security;
revoke all on bos_hands_private.deliveries from public, anon, authenticated;
grant all on bos_hands_private.deliveries to service_role;

create or replace function public.bos_hands_report_runtime()
returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object('enabled',r.enabled,'workerKey',s.decrypted_secret)
  from bos_hands_private.runtime r join vault.decrypted_secrets s on s.id=r.worker_secret_id where r.singleton;
$$;

create or replace function bos_hands_private.kick()
returns void language plpgsql security definer set search_path='' as $$
declare r bos_hands_private.runtime; token text;
begin
  if not exists(select 1 from bos_hands_private.deliveries where
    (state in ('queued','retry') and next_attempt_at<=now()) or (state='processing' and locked_until<now())) then return; end if;
  update bos_hands_private.runtime set next_kick_at=clock_timestamp()+interval '5 seconds'
    where singleton and enabled and worker_url is not null and next_kick_at<=clock_timestamp() returning * into r;
  if r.singleton is null then return; end if;
  select decrypted_secret into token from vault.decrypted_secrets where id=r.worker_secret_id;
  perform net.http_post(url:=r.worker_url,headers:=jsonb_build_object('Content-Type','application/json','X-BOS-Hands-Worker',token),
    body:='{"action":"worker"}'::jsonb,timeout_milliseconds:=65000);
exception when others then
  -- The committed queue survives a failed wake-up; cron recovers it.
  raise log 'BOS Hands wake failed, SQLSTATE=%',sqlstate;
end $$;

create or replace function bos_hands_private.capture_report()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.report_review_status='approved' and new.status::text='Выполнена'
    and (old.report_review_status is distinct from 'approved' or old.report_upload_token is distinct from new.report_upload_token)
    and lower(coalesce(new.external_source,''))='hands'
    and nullif(new.external_id,'') is not null and nullif(new.report_upload_token,'') is not null
    and exists(select 1 from bos_hands_private.runtime where enabled) then
    insert into bos_hands_private.deliveries(order_id,report_token,snapshot)
      values(new.id,new.report_upload_token,jsonb_build_object(
        'id',new.id,'external_id',new.external_id,'report_upload_token',new.report_upload_token,
        'report_type',new.report_type,'report_act_url',new.report_act_url,'report_measurement_url',new.report_measurement_url,
        'report_photo_urls',new.report_photo_urls,'report_reviewed_at',new.report_reviewed_at,
        'report_review_comment',new.report_review_comment,'work',new.work,
        'extra_work_done',new.extra_work_done,'extra_work_description',new.extra_work_description,'extra_work_amount',new.extra_work_amount,
        'uncompleted_work_done',new.uncompleted_work_done,'uncompleted_work_description',new.uncompleted_work_description,'uncompleted_work_amount',new.uncompleted_work_amount))
      on conflict(order_id,report_token) do nothing;
    perform bos_hands_private.kick();
  end if;
  return new;
end $$;
drop trigger if exists bos_hands_capture_report on public.orders;
create trigger bos_hands_capture_report after update of report_review_status,report_upload_token on public.orders
  for each row execute function bos_hands_private.capture_report();

create or replace function public.bos_hands_report_claim()
returns jsonb language plpgsql security definer set search_path='' as $$
declare d bos_hands_private.deliveries;
begin
  if not exists(select 1 from bos_hands_private.runtime where enabled) then return null; end if;
  select * into d from bos_hands_private.deliveries where
    (state in ('queued','retry') and next_attempt_at<=now()) or (state='processing' and locked_until<now())
    order by next_attempt_at,created_at for update skip locked limit 1;
  if d.id is null then return null; end if;
  if d.inflight then
    update bos_hands_private.deliveries set state='attention',uncertain=true,lease=null,locked_until=null,
      error='Hands мог принять отправку. Проверьте этот шаг в Hands перед повтором.',version=gen_random_uuid(),updated_at=now() where id=d.id;
    return jsonb_build_object('attention',true);
  end if;
  update bos_hands_private.deliveries set state='processing',lease=gen_random_uuid(),locked_until=now()+interval '120 seconds',
    updated_at=now(),version=gen_random_uuid() where id=d.id returning * into d;
  return to_jsonb(d);
end $$;

-- Every provider POST must first acquire an intent on the exact current receipt.
-- A worker crash after intent is uncertain and is never replayed automatically.
create or replace function public.bos_hands_report_step(p_id uuid,p_lease uuid,p_step integer,p_action text,p_error text default null,p_uncertain boolean default false,p_label text default null,p_final boolean default false)
returns boolean language plpgsql security definer set search_path='' as $$
declare d bos_hands_private.deliveries; o public.orders; oid bigint;
begin
  select order_id into oid from bos_hands_private.deliveries where id=p_id;
  -- Match order->queue lock ordering used by the approval trigger.
  select * into o from public.orders where id=oid for update;
  select * into d from bos_hands_private.deliveries where id=p_id for update;
  if d.id is null or d.state<>'processing' or d.lease is distinct from p_lease or d.step<>p_step or d.locked_until<=now() then return false; end if;
  if p_action='begin' then
    if d.inflight then return false; end if;
    if o.report_review_status is distinct from 'approved' or o.status::text is distinct from 'Выполнена'
      or o.report_upload_token is distinct from d.report_token or o.external_id is distinct from d.snapshot->>'external_id'
      or lower(coalesce(o.external_source,''))<>'hands' then
      update bos_hands_private.deliveries set state='cancelled',error='Заявка или принятый отчёт изменены.',lease=null,locked_until=null,
        updated_at=now(),version=gen_random_uuid() where id=d.id; return false;
    end if;
    if not exists(select 1 from bos_hands_private.runtime where enabled) then return false; end if;
    update bos_hands_private.deliveries set inflight=true,step_label=left(p_label,180),final_step=p_final,
      locked_until=now()+interval '120 seconds',updated_at=now(),version=gen_random_uuid() where id=d.id;
  elsif p_action in ('advance','sent') then
    if not d.inflight or (p_action='sent') is distinct from d.final_step then return false; end if;
    update bos_hands_private.deliveries set step=step+1,inflight=false,uncertain=false,error=null,failures=0,
      state=case when p_action='sent' then 'sent' else 'processing' end,
      sent_at=case when p_action='sent' then now() else null end,
      lease=case when p_action='sent' then null else lease end,
      locked_until=case when p_action='sent' then null else now()+interval '120 seconds' end,
      updated_at=now(),version=gen_random_uuid() where id=d.id;
  elsif p_action in ('retry','attention','yield') then
    if p_action='yield' and d.inflight then return false; end if;
    update bos_hands_private.deliveries set
      state=case when p_action='yield' then 'queued' when p_action='attention' or failures>=7 then 'attention' else 'retry' end,
      failures=failures+case when p_action='yield' then 0 else 1 end,
      inflight=false,uncertain=p_uncertain,error=left(p_error,400),lease=null,locked_until=null,
      next_attempt_at=now()+case when p_action='yield' then interval '5 seconds' else least(3600,30*power(2,least(failures,7))) * interval '1 second' end,
      updated_at=now(),version=gen_random_uuid() where id=d.id;
  else raise exception 'Invalid Hands queue action';
  end if;
  return true;
end $$;

create or replace function public.bos_hands_report_status(p_order bigint)
returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object('id',d.id,'state',d.state,'step',d.step,'step_label',d.step_label,'uncertain',d.uncertain,'error',d.error,
    'version',d.version,'sent_at',d.sent_at,'next_attempt_at',d.next_attempt_at)
  from bos_hands_private.deliveries d join public.orders o on o.id=d.order_id and o.report_upload_token=d.report_token
  where d.order_id=p_order order by d.created_at desc limit 1;
$$;

create or replace function public.bos_hands_report_retry(p_order bigint,p_version uuid,p_confirm boolean default false,p_received boolean default false)
returns boolean language plpgsql security definer set search_path='' as $$
declare o public.orders; d bos_hands_private.deliveries;
begin
  select * into o from public.orders where id=p_order for update;
  if o.report_review_status is distinct from 'approved' or o.status::text is distinct from 'Выполнена' then return false; end if;
  select * into d from bos_hands_private.deliveries where order_id=p_order and report_token=o.report_upload_token for update;
  if d.id is null or d.version is distinct from p_version or d.state<>'attention' or (d.uncertain and not p_confirm)
    or (p_received and (not d.uncertain or not p_confirm)) then return false; end if;
  update bos_hands_private.deliveries set state=case when p_received and final_step then 'sent' else 'queued' end,
    step=step+case when p_received then 1 else 0 end,
    sent_at=case when p_received and final_step then now() else null end,
    inflight=false,uncertain=false,failures=0,error=null,
    lease=null,locked_until=null,next_attempt_at=now(),updated_at=now(),version=gen_random_uuid() where id=d.id;
  perform bos_hands_private.kick(); return true;
end $$;

revoke all on function bos_hands_private.kick(),bos_hands_private.capture_report(),
  public.bos_hands_report_runtime(),public.bos_hands_report_claim(),
  public.bos_hands_report_step(uuid,uuid,integer,text,text,boolean,text,boolean),public.bos_hands_report_status(bigint),
  public.bos_hands_report_retry(bigint,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function bos_hands_private.kick(),public.bos_hands_report_runtime(),public.bos_hands_report_claim(),
  public.bos_hands_report_step(uuid,uuid,integer,text,text,boolean,text,boolean),public.bos_hands_report_status(bigint),
  public.bos_hands_report_retry(bigint,uuid,boolean,boolean) to service_role;
