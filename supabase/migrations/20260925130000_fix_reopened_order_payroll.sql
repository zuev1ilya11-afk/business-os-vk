-- Keep payroll eligibility and the master's workflow aligned with the order's current business status.
-- A management return to work must start a fresh master cycle instead of reusing completed steps/report data.

create or replace function public.guard_order_completion()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  rejected_now boolean;
  restart_cycle boolean;
begin
  rejected_now := new.report_review_status = 'rejected'
    and old.report_review_status is distinct from 'rejected';

  restart_cycle := new.status = 'В работе'
    and (
      old.status is distinct from 'В работе'
      or rejected_now
    );

  if new.status = 'Выполнена' and old.status is distinct from 'Выполнена' then
    if new.report_uploaded_at is null
       or coalesce(nullif(trim(new.report_act_url),''),'') = ''
       or coalesce(nullif(trim(new.report_photo_urls),''),'') = ''
       or new.report_photo_urls = '[]' then
      raise exception 'REPORT_REQUIRED_BEFORE_COMPLETION';
    end if;
    if new.report_type = 'measurement' and coalesce(nullif(trim(new.report_measurement_url),''),'') = '' then
      raise exception 'MEASUREMENT_REPORT_REQUIRED';
    end if;
  end if;

  if restart_cycle then
    new.master_workflow_stage := 'assigned';
    new.master_called_at := null;
    new.master_agreed_at := null;
    new.master_departed_at := null;
    new.master_arrived_at := null;
    new.master_started_at := null;
    new.completed_at := null;

    new.report_type := null;
    new.report_act_url := null;
    new.report_measurement_url := null;
    new.report_photo_urls := '[]';
    new.report_uploaded_at := null;
    new.report_upload_token := null;
    new.report_archive_url := null;

    new.drive_archive_status := 'pending';
    new.drive_archive_folder_id := null;
    new.drive_archive_url := null;
    new.drive_archive_error := null;
    new.drive_archived_at := null;

    if not rejected_now then
      new.report_review_status := 'not_submitted';
      new.report_reviewed_by := null;
      new.report_reviewed_at := null;
      new.report_review_comment := '';
    end if;
  end if;

  if new.status is distinct from 'Выполнена' then
    new.completed_at := null;
    if old.status = 'Выполнена' or new.report_review_status = 'approved' then
      new.report_review_status := case
        when new.report_uploaded_at is not null then 'pending'
        else 'not_submitted'
      end;
      new.report_reviewed_by := null;
      new.report_reviewed_at := null;
      new.report_review_comment := '';
    end if;
  end if;

  return new;
end;
$function$;

-- Repair any stale rows that may exist before this guard is installed.
update public.orders
set completed_at = null,
    report_review_status = case
      when report_uploaded_at is not null then 'pending'
      else 'not_submitted'
    end,
    report_reviewed_by = null,
    report_reviewed_at = null,
    report_review_comment = ''
where status is distinct from 'Выполнена'
  and (completed_at is not null or report_review_status = 'approved');
