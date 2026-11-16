-- Preserve reviewed/removed report versions before the existing order guard
-- clears their pointers. Additive only: no historical orders or money change.
-- Apply to an isolated test copy first. Existing erased versions cannot be rebuilt.
BEGIN;

DO $$
declare required_column text;
begin
  if to_regclass('public.orders') is null then
    raise exception 'REPORT_REVISIONS_PREFLIGHT: public.orders missing';
  end if;
  foreach required_column in array array['id','status','report_upload_token',
    'report_uploaded_at','report_review_status','report_reviewed_by',
    'report_reviewed_at','report_review_comment','report_act_url','report_photo_urls'] loop
    if not exists(select 1 from pg_attribute where attrelid='public.orders'::regclass
      and attname=required_column and attnum>0 and not attisdropped) then
      raise exception 'REPORT_REVISIONS_PREFLIGHT: orders.% missing',required_column;
    end if;
  end loop;
  if not exists(select 1 from pg_attribute where attrelid='public.orders'::regclass
    and attname='id' and atttypid in ('bigint'::regtype,'integer'::regtype,'text'::regtype,'uuid'::regtype)) then
    raise exception 'REPORT_REVISIONS_PREFLIGHT: unsupported orders.id type';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.orders'::regclass
    and tgfoid=to_regprocedure('public.guard_order_completion()') and not tgisinternal and tgenabled<>'D') then
    raise exception 'REPORT_REVISIONS_PREFLIGHT: active completion guard missing';
  end if;
  if exists(select 1 from public.orders where
    (nullif(trim(report_act_url),'') is not null or
      coalesce(nullif(trim(report_photo_urls),''),'[]')<>'[]')
    and (report_uploaded_at is null or nullif(trim(report_upload_token),'') is null)) then
    raise exception 'REPORT_REVISIONS_PREFLIGHT: legacy report without version; reconcile before migration';
  end if;
end $$;

create schema if not exists bos_report_private;
revoke all on schema bos_report_private from public, anon, authenticated, service_role;
grant usage on schema bos_report_private to service_role;

create table if not exists bos_report_private.order_report_revisions (
  -- Text preserves the existing key without casting or a cascading delete.
  order_id text not null,
  report_upload_token text not null check (length(trim(report_upload_token))>0),
  report_uploaded_at timestamptz not null,
  review_status text,
  reviewed_by text,
  reviewed_at timestamptz,
  review_comment text,
  capture_reason text not null check (capture_reason in ('approved','rejected','removed')),
  report_data jsonb not null check (jsonb_typeof(report_data)='object'),
  saved_at timestamptz not null default clock_timestamp(),
  primary key (order_id,report_upload_token,report_uploaded_at)
);
alter table bos_report_private.order_report_revisions enable row level security;
revoke all on bos_report_private.order_report_revisions from public, anon, authenticated, service_role;
grant select on bos_report_private.order_report_revisions to service_role;

create or replace function bos_report_private.capture_revision()
returns trigger language plpgsql security definer set search_path='' as $$
declare old_data jsonb:=to_jsonb(old);
  snapshot jsonb; decision boolean; reason text;
begin
  if old.report_uploaded_at is null or nullif(trim(old.report_upload_token),'') is null then
    if (nullif(trim(old.report_act_url),'') is not null or
        coalesce(nullif(trim(old.report_photo_urls),''),'[]')<>'[]')
      and (new.report_act_url is distinct from old.report_act_url
        or new.report_photo_urls is distinct from old.report_photo_urls
        or new.report_review_status is distinct from old.report_review_status) then
      raise exception 'REPORT_REVISION_VERSION_REQUIRED';
    end if;
    return new;
  end if;
  decision := new.report_review_status in ('approved','rejected')
    and new.report_review_status is distinct from old.report_review_status;
  if not coalesce(decision,false)
    and new.report_upload_token is not distinct from old.report_upload_token
    and new.report_uploaded_at is not distinct from old.report_uploaded_at then
    return new;
  end if;
  reason:=case when decision then new.report_review_status else 'removed' end;
  -- Explicit report/work fields keep company payroll and unrelated client data
  -- out of this archive. Optional fields are captured only when present.
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into snapshot
  from jsonb_each(old_data) where key=any(array[
    'report_type','report_act_url','report_measurement_url','report_photo_urls',
    'report_archive_url','drive_archive_status','drive_archive_folder_id',
    'drive_archive_url','drive_archived_at','work','work_items','comment',
    'extra_work_done','extra_work_description','extra_work_amount',
    'uncompleted_work_done','uncompleted_work_description','uncompleted_work_amount',
    'uncompleted_work_items','master_staff_id','master_workflow_stage',
    'master_called_at','master_agreed_at','master_departed_at','master_arrived_at',
    'master_started_at','scheduled_date','scheduled_time','time_slot']);
  insert into bos_report_private.order_report_revisions
    (order_id,report_upload_token,report_uploaded_at,review_status,reviewed_by,
     reviewed_at,review_comment,capture_reason,report_data)
  values (old.id::text,old.report_upload_token,old.report_uploaded_at,
    case when decision then new.report_review_status else old.report_review_status end,
    case when decision then new.report_reviewed_by else old.report_reviewed_by end,
    case when decision then new.report_reviewed_at else old.report_reviewed_at end,
    case when decision then new.report_review_comment else old.report_review_comment end,
    reason,snapshot)
  on conflict (order_id,report_upload_token,report_uploaded_at) do nothing;
  -- Deliberately no exception suppression: if preservation fails, the same
  -- transaction must keep the original report and reject the destructive update.
  return new;
end $$;
revoke all on function bos_report_private.capture_revision() from public, anon, authenticated, service_role;

drop trigger if exists bos_capture_report_revision on public.orders;
create trigger bos_capture_report_revision after update on public.orders
  for each row execute function bos_report_private.capture_revision();

COMMENT ON TABLE bos_report_private.order_report_revisions IS
  'Immutable report versions captured atomically at review/removal; server-only recovery access, no browser grants. Retain on code rollback.';
COMMIT;
