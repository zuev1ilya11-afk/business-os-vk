-- Web Push is additive. Existing order, payroll and authentication behavior is untouched.
-- Enable runtime delivery only after deploying the matching push-api and testing its worker.
create schema if not exists bos_push_private;
revoke all on schema bos_push_private from public, anon, authenticated;
grant usage on schema bos_push_private to service_role;

create table if not exists bos_push_private.runtime (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  public_key text,
  private_secret_id uuid,
  worker_secret_id uuid not null,
  worker_url text,
  next_kick_at timestamptz not null default '-infinity'
);
alter table bos_push_private.runtime enable row level security;
revoke all on bos_push_private.runtime from public, anon, authenticated;
grant all on bos_push_private.runtime to service_role;
do $$
begin
  if not exists(select 1 from bos_push_private.runtime) then
    insert into bos_push_private.runtime(worker_secret_id)
      values(vault.create_secret(replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''), 'bos-push-worker-v1'));
  end if;
end $$;

create table if not exists public.bos_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.business_staff(id) on delete cascade,
  external_id text not null,
  endpoint text not null unique check (length(endpoint) between 20 and 2048),
  p256dh text not null,
  auth_key text not null,
  revoke_hash text not null check (revoke_hash ~ '^[a-f0-9]{64}$'),
  binding_id uuid not null default gen_random_uuid(),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '30 days'),
  last_test_at timestamptz
);
create index if not exists bos_push_subscriptions_staff on public.bos_push_subscriptions(staff_id) where active;
alter table public.bos_push_subscriptions enable row level security;
revoke all on public.bos_push_subscriptions from public, anon, authenticated;
grant all on public.bos_push_subscriptions to service_role;

create table if not exists public.bos_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  subscription_id uuid not null references public.bos_push_subscriptions(id) on delete cascade,
  binding_id uuid not null,
  event_type text not null check(event_type in ('assigned','unassigned','rescheduled','cancelled','report_rejected','new_order','report_pending','test')),
  order_id bigint references public.orders(id) on delete cascade,
  state text not null default 'pending' check(state in ('pending','sending','sent','discarded')),
  attempts integer not null default 0 check(attempts between 0 and 5),
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  lease_token uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '15 minutes'),
  last_http_status integer,
  unique(event_id, subscription_id)
);
create index if not exists bos_push_deliveries_pending on public.bos_push_deliveries(next_attempt_at) where state in ('pending','sending');
alter table public.bos_push_deliveries enable row level security;
revoke all on public.bos_push_deliveries from public, anon, authenticated;
grant all on public.bos_push_deliveries to service_role;

-- Service-only RPCs. No browser role can call these or read a device endpoint/key.
create or replace function public.bos_push_runtime()
returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object('enabled',r.enabled,'publicKey',r.public_key,
    'privateKey',(select decrypted_secret from vault.decrypted_secrets where id=r.private_secret_id),
    'workerKey',(select decrypted_secret from vault.decrypted_secrets where id=r.worker_secret_id))
  from bos_push_private.runtime r where r.singleton;
$$;
revoke all on function public.bos_push_runtime() from public, anon, authenticated;
grant execute on function public.bos_push_runtime() to service_role;

create or replace function public.bos_push_set_vapid(p_public text,p_private text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r bos_push_private.runtime;
begin
  if p_public !~ '^[A-Za-z0-9_-]{87}$' or p_private !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'Invalid VAPID key'; end if;
  select * into r from bos_push_private.runtime where singleton for update;
  if r.private_secret_id is null then
    update bos_push_private.runtime set public_key=p_public,
      private_secret_id=vault.create_secret(p_private,'bos-push-vapid-v1') where singleton;
  end if;
  return public.bos_push_runtime();
end $$;
revoke all on function public.bos_push_set_vapid(text,text) from public, anon, authenticated;
grant execute on function public.bos_push_set_vapid(text,text) to service_role;

create or replace function public.bos_push_subscribe(p_staff uuid,p_external text,p_endpoint text,p_p256dh text,p_auth text,p_revoke_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.bos_push_subscriptions;
begin
  -- Serialize device limits and races without trusting any client-supplied staff ID.
  perform 1 from public.business_staff where id=p_staff and external_id=p_external and is_active
    and role in ('owner','manager','dispatcher','master') for update;
  if not found then raise exception 'Inactive staff'; end if;
  select * into s from public.bos_push_subscriptions where endpoint=p_endpoint for update;
  if found and s.active and s.revoke_hash<>p_revoke_hash then
    return jsonb_build_object('conflict',true);
  end if;
  if (s.id is null or s.staff_id<>p_staff or not s.active) and
     (select count(*) from public.bos_push_subscriptions where staff_id=p_staff and active and expires_at>now())>=8 then
    return jsonb_build_object('limit',true);
  end if;
  insert into public.bos_push_subscriptions as current(staff_id,external_id,endpoint,p256dh,auth_key,revoke_hash)
    values(p_staff,p_external,p_endpoint,p_p256dh,p_auth,p_revoke_hash)
    on conflict(endpoint) do update set staff_id=excluded.staff_id,external_id=excluded.external_id,
      p256dh=excluded.p256dh,auth_key=excluded.auth_key,revoke_hash=excluded.revoke_hash,active=true,
      binding_id=case when current.active and current.staff_id=excluded.staff_id and current.external_id=excluded.external_id
        and current.p256dh=excluded.p256dh and current.auth_key=excluded.auth_key and current.revoke_hash=excluded.revoke_hash
        then current.binding_id else gen_random_uuid() end,
      updated_at=now(),expires_at=now()+interval '30 days'
    where not current.active or current.revoke_hash=excluded.revoke_hash
    returning * into s;
  if s.id is null then return jsonb_build_object('conflict',true); end if;
  return jsonb_build_object('id',s.id,'binding_id',s.binding_id,'expires_at',s.expires_at);
end $$;
revoke all on function public.bos_push_subscribe(uuid,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.bos_push_subscribe(uuid,text,text,text,text,text) to service_role;

-- This capability can only revoke one exact subscription. It grants no read or send permission.
create or replace function public.bos_push_revoke(p_endpoint text,p_revoke_hash text)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  update public.bos_push_subscriptions set active=false,updated_at=now()
    where endpoint=p_endpoint and revoke_hash=p_revoke_hash;
  return true;
end $$;
revoke all on function public.bos_push_revoke(text,text) from public, anon, authenticated;
grant execute on function public.bos_push_revoke(text,text) to service_role;

-- One short, debounced asynchronous wake-up; pg_net sends only after commit.
-- A minute-based cron job provides recovery. Notification outages never roll back an order.
create or replace function bos_push_private.kick()
returns void language plpgsql security definer set search_path='' as $$
declare r bos_push_private.runtime; token text;
begin
  update bos_push_private.runtime set next_kick_at=clock_timestamp()+interval '3 seconds'
    where singleton and enabled and worker_url is not null and next_kick_at<=clock_timestamp()
    returning * into r;
  if r.singleton is null then return; end if;
  select decrypted_secret into token from vault.decrypted_secrets where id=r.worker_secret_id;
  perform net.http_post(url:=r.worker_url,
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),
    body:='{"action":"worker"}'::jsonb,timeout_milliseconds:=30000);
exception when others then
  raise log 'BOS push wake failed, SQLSTATE=%',sqlstate;
end $$;
revoke all on function bos_push_private.kick() from public, anon, authenticated;
grant execute on function bos_push_private.kick() to service_role;

create or replace function bos_push_private.enqueue(p_order bigint,p_type text,p_staff uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare event uuid:=gen_random_uuid();
begin
  insert into public.bos_push_deliveries(event_id,subscription_id,binding_id,event_type,order_id)
    select event,s.id,s.binding_id,p_type,p_order from public.bos_push_subscriptions s
    join public.business_staff b on b.id=s.staff_id and b.external_id=s.external_id and b.is_active
    where s.active and s.expires_at>now()
      and ((p_staff is not null and b.id=p_staff and b.role='master') or
           (p_staff is null and p_type in ('new_order','report_pending') and b.role in ('owner','manager','dispatcher')))
      and exists(select 1 from bos_push_private.runtime where enabled)
    on conflict(event_id,subscription_id) do nothing;
  if found then perform bos_push_private.kick(); end if;
end $$;
revoke all on function bos_push_private.enqueue(bigint,text,uuid) from public, anon, authenticated;

create or replace function bos_push_private.capture_order()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from bos_push_private.runtime where enabled) then return new; end if;
  if tg_op='INSERT' then
    if new.status::text not in ('Отменена','Выполнена') then
      perform bos_push_private.enqueue(new.id,'new_order');
      if new.master_staff_id is not null then perform bos_push_private.enqueue(new.id,'assigned',new.master_staff_id); end if;
    end if;
    return new;
  end if;
  if old.master_staff_id is distinct from new.master_staff_id then
    if old.master_staff_id is not null then perform bos_push_private.enqueue(new.id,'unassigned',old.master_staff_id); end if;
    if new.master_staff_id is not null and new.status::text not in ('Отменена','Выполнена') then
      perform bos_push_private.enqueue(new.id,'assigned',new.master_staff_id);
    end if;
  end if;
  if new.master_staff_id is not null then
    if new.status::text='Отменена' and old.status::text is distinct from 'Отменена' then
      perform bos_push_private.enqueue(new.id,'cancelled',new.master_staff_id);
    elsif new.status::text not in ('Отменена','Выполнена') and old.master_staff_id is not distinct from new.master_staff_id
      and (old.scheduled_date is distinct from new.scheduled_date or old.scheduled_time is distinct from new.scheduled_time or old.time_slot is distinct from new.time_slot) then
      perform bos_push_private.enqueue(new.id,'rescheduled',new.master_staff_id);
    end if;
    if new.report_review_status='rejected' and old.report_review_status is distinct from 'rejected' then
      perform bos_push_private.enqueue(new.id,'report_rejected',new.master_staff_id);
    end if;
  end if;
  if new.report_review_status='pending' and new.report_uploaded_at is not null and
    (old.report_review_status is distinct from 'pending' or old.report_uploaded_at is distinct from new.report_uploaded_at) then
    perform bos_push_private.enqueue(new.id,'report_pending');
  end if;
  return new;
exception when others then
  raise log 'BOS push enqueue failed, SQLSTATE=%',sqlstate;
  return new;
end $$;
revoke all on function bos_push_private.capture_order() from public, anon, authenticated;
drop trigger if exists bos_push_capture_order on public.orders;
create trigger bos_push_capture_order after insert or update of master_staff_id,status,scheduled_date,scheduled_time,time_slot,report_review_status,report_uploaded_at
  on public.orders for each row execute function bos_push_private.capture_order();

create or replace function public.bos_push_test(p_staff uuid,p_endpoint text,p_revoke_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.bos_push_subscriptions; d uuid;
begin
  select * into s from public.bos_push_subscriptions where staff_id=p_staff and endpoint=p_endpoint
    and revoke_hash=p_revoke_hash and active and expires_at>now() for update;
  if s.id is null then return jsonb_build_object('missing',true); end if;
  if s.last_test_at>now()-interval '60 seconds' then return jsonb_build_object('limited',true); end if;
  update public.bos_push_subscriptions set last_test_at=now() where id=s.id;
  insert into public.bos_push_deliveries(event_id,subscription_id,binding_id,event_type,expires_at)
    values(gen_random_uuid(),s.id,s.binding_id,'test',now()+interval '5 minutes') returning id into d;
  perform bos_push_private.kick();
  return jsonb_build_object('queued',true,'id',d);
end $$;
revoke all on function public.bos_push_test(uuid,text,text) from public, anon, authenticated;
grant execute on function public.bos_push_test(uuid,text,text) to service_role;

create or replace function public.bos_push_claim()
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  update public.bos_push_deliveries set state='discarded',lease_token=null
    where state in ('pending','sending') and (expires_at<=now() or (attempts>=5 and coalesce(locked_until,'-infinity')<now()));
  with selected as (
    select id from public.bos_push_deliveries where expires_at>now() and attempts<5 and
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
    and ((d.event_type='test' and b.role in ('owner','manager','dispatcher','master'))
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
      when p_retry and attempts<5 and expires_at>now() then 'pending' else 'discarded' end,
    next_attempt_at=now()+least(300,30*power(2,greatest(attempts-1,0)))::integer*interval '1 second',
    locked_until=null,lease_token=null,last_http_status=p_status where id=d.id;
end $$;
revoke all on function public.bos_push_finish(uuid,uuid,integer,boolean) from public, anon, authenticated;
grant execute on function public.bos_push_finish(uuid,uuid,integer,boolean) to service_role;

create or replace function bos_push_private.maintenance()
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.bos_push_subscriptions set active=false where active and expires_at<=now();
  delete from public.bos_push_deliveries where expires_at<now()-interval '7 days';
  delete from public.bos_push_subscriptions where not active and updated_at<now()-interval '30 days';
  if exists(select 1 from public.bos_push_deliveries where state in ('pending','sending')) then
    perform bos_push_private.kick();
  end if;
end $$;
revoke all on function bos_push_private.maintenance() from public, anon, authenticated;
grant execute on function bos_push_private.maintenance() to service_role;
