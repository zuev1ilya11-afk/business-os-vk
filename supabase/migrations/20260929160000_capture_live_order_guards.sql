-- Captured read-only from production on 2026-09-29; preserves existing behavior.
-- No historical payout recalculation. Applying to production is a separate operation.

CREATE OR REPLACE FUNCTION public.guard_order_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
DROP TRIGGER IF EXISTS trg_guard_order_completion ON public.orders;
CREATE TRIGGER trg_guard_order_completion BEFORE UPDATE OF status, report_review_status ON public.orders FOR EACH ROW EXECUTE FUNCTION guard_order_completion();

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$ begin new.updated_at=now(); return new; end $function$;
DROP TRIGGER IF EXISTS trg_orders_updated_at ON public.orders;
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE OR REPLACE FUNCTION public.zero_payouts_on_cancelled_orders()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.status::text = 'Отменена' then
    new.master_payout := 0;
    new.manager_payout := 0;
    new.dispatcher_payout := 0;
  end if;
  return new;
end;
$function$;
DROP TRIGGER IF EXISTS trg_zero_payouts_on_cancelled_orders ON public.orders;
CREATE TRIGGER trg_zero_payouts_on_cancelled_orders BEFORE INSERT OR UPDATE OF status, master_payout, manager_payout, dispatcher_payout ON public.orders FOR EACH ROW EXECUTE FUNCTION zero_payouts_on_cancelled_orders();

