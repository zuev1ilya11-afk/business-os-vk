-- Preserve submitted reports across the initial active status transition.
-- Function-only change; no historical orders are updated.
CREATE OR REPLACE FUNCTION public.guard_order_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  rejected_now boolean;
  restart_cycle boolean;
  submitting_report boolean;
begin
  rejected_now := new.report_review_status = 'rejected'
    and old.report_review_status is distinct from 'rejected';

  -- Starting work from Новая/Назначена while submitting is not a new visit.
  -- Keep the original reset on rejection and reopening a terminal order.
  submitting_report := coalesce(
    new.report_review_status = 'pending'
    and coalesce(old.report_review_status, '') not in ('pending', 'approved')
    and coalesce(old.status::text, '') not in ('Выполнена', 'Отменена')
    and (old.master_workflow_stage = 'started' or old.master_started_at is not null
         or old.report_review_status = 'rejected' or old.report_uploaded_at is not null)
    and new.report_type = 'work'
    and new.report_uploaded_at is not null
    and nullif(trim(new.report_upload_token), '') is not null
    and new.report_upload_token is distinct from old.report_upload_token
    and nullif(trim(new.report_act_url), '') is not null
    and nullif(trim(new.report_photo_urls), '') is not null
    and new.report_photo_urls <> '[]', false);

  restart_cycle := new.status = 'В работе'
    and (
      (old.status is distinct from 'В работе' and not submitting_report)
      or rejected_now
    );

  if new.status = 'Выполнена' and old.status is distinct from 'Выполнена'
    and not (current_user = 'service_role' and coalesce(current_setting('bos.manual_completion_order',true),'') = old.id::text) then
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

