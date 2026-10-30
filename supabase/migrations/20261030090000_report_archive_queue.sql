alter table public.orders add column if not exists report_reviewer_staff_id uuid;
-- Approval and the durable archive job commit together. No historical backfill.
create schema if not exists bos_drive_private;
revoke all on schema bos_drive_private from public, anon, authenticated;
create table if not exists bos_drive_private.jobs (
 order_id bigint not null references public.orders(id) on delete cascade, report_token text not null, report_uploaded_at timestamptz not null,
 snapshot jsonb not null, state text not null default 'pending' check(state in ('pending','processing','completed','failed')),
 attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
 lease uuid, locked_until timestamptz, error text, updated_at timestamptz not null default now(),
 primary key(order_id,report_token,report_uploaded_at)
);
create index if not exists bos_drive_jobs_due on bos_drive_private.jobs(next_attempt_at) where state in ('pending','failed','processing');
alter table bos_drive_private.jobs enable row level security;
revoke all on bos_drive_private.jobs from public,anon,authenticated;

create or replace function bos_drive_private.capture() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.report_review_status='approved' and new.status::text='Выполнена' and new.report_upload_token is not null
 and (old.report_review_status is distinct from 'approved' or old.report_upload_token is distinct from new.report_upload_token or old.report_uploaded_at is distinct from new.report_uploaded_at)
 and coalesce(new.drive_archive_status,'') not in ('archived','completed') then
  insert into bos_drive_private.jobs(order_id,report_token,report_uploaded_at,snapshot) values(new.id,new.report_upload_token,new.report_uploaded_at,to_jsonb(new))
  on conflict(order_id,report_token,report_uploaded_at) do nothing;
 end if;
 return new;
end $$;
drop trigger if exists bos_drive_capture on public.orders;
create trigger bos_drive_capture after update of report_review_status,report_upload_token,report_uploaded_at on public.orders
 for each row execute function bos_drive_private.capture();

create or replace function public.bos_drive_claim() returns jsonb language plpgsql security definer set search_path='' as $$
declare j bos_drive_private.jobs;
begin
 select * into j from bos_drive_private.jobs
 where (state in ('pending','failed') and next_attempt_at<=now()) or (state='processing' and locked_until<now())
 order by next_attempt_at limit 1;
 if j.order_id is null then return null; end if;
 perform 1 from public.orders where id=j.order_id for update skip locked;
 if not found then return null; end if;
 select * into j from bos_drive_private.jobs where order_id=j.order_id and report_token=j.report_token and report_uploaded_at=j.report_uploaded_at
 and ((state in ('pending','failed') and next_attempt_at<=now()) or (state='processing' and locked_until<now())) for update skip locked;
 if j.order_id is null then return null; end if;
 update bos_drive_private.jobs set state='processing',lease=gen_random_uuid(),locked_until=now()+interval '10 minutes',
 attempts=attempts+1,updated_at=now() where order_id=j.order_id and report_token=j.report_token and report_uploaded_at=j.report_uploaded_at returning * into j;
 update public.orders set drive_archive_status='processing' where id=j.order_id and report_upload_token=j.report_token and report_uploaded_at=j.report_uploaded_at and report_review_status='approved' and coalesce(drive_archive_status,'') not in ('archived','completed');
 return to_jsonb(j);
end $$;

create or replace function public.bos_drive_finish(p_order bigint,p_token text,p_uploaded_at timestamptz,p_lease uuid,p_result jsonb default null,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare j bos_drive_private.jobs; o public.orders;
begin
 -- Match order -> queue ordering used by the approval trigger; never reverse these locks.
 select * into o from public.orders where id=p_order for update;
 select * into j from bos_drive_private.jobs where order_id=p_order and report_token=p_token and report_uploaded_at=p_uploaded_at for update;
 if j.state is distinct from 'processing' or j.lease is distinct from p_lease or j.locked_until<=now() then return false; end if;
 if p_result is not null and coalesce(p_result->>'drive_folder_url','') !~ '^https://' then raise exception 'INVALID_ARCHIVE_RECEIPT'; end if;
 update bos_drive_private.jobs set state=case when p_result is null then 'failed' else 'completed' end,
 error=case when p_result is null then left(coalesce(p_error,'ARCHIVE_FAILED'),500) else null end,
 next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,least(j.attempts,7)))::integer),
 lease=null,locked_until=null,updated_at=now() where order_id=p_order and report_token=p_token and report_uploaded_at=p_uploaded_at;
 -- A new/rejected/reopened report is never changed by an old worker.
 if o.report_upload_token=p_token and o.report_uploaded_at=p_uploaded_at and o.report_review_status='approved' and o.status::text='Выполнена'
 and coalesce(o.drive_archive_status,'') not in ('archived','completed') then
  update public.orders set drive_archive_status=case when p_result is null then 'failed' else 'archived' end,
  drive_archive_error=case when p_result is null then left(coalesce(p_error,'ARCHIVE_FAILED'),500) else null end,
  drive_archive_url=coalesce(p_result->>'drive_folder_url',drive_archive_url),
  drive_archive_folder_id=coalesce(p_result->>'drive_folder_id',drive_archive_folder_id),
  drive_archived_at=case when p_result is not null then now() else drive_archived_at end
  where id=p_order;
 end if;
 return true;
end $$;
revoke all on function bos_drive_private.capture(),public.bos_drive_claim(),public.bos_drive_finish(bigint,text,timestamptz,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.bos_drive_claim(),public.bos_drive_finish(bigint,text,timestamptz,uuid,jsonb,text) to service_role;
