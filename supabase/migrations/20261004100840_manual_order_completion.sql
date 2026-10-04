-- Audited leadership exception to report-required completion. No financial/report changes.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS manual_completion_history jsonb NOT NULL DEFAULT '[]'::jsonb
 CHECK (jsonb_typeof(manual_completion_history) = 'array');
COMMENT ON COLUMN public.orders.manual_completion_history IS 'Append-only manual closure audit, written only by bos_manual_complete_order; preserved when reopened.';

CREATE OR REPLACE FUNCTION public.guard_manual_completion_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
  IF new.manual_completion_history <> '[]'::jsonb THEN RAISE EXCEPTION 'MANUAL_AUDIT_READ_ONLY' USING ERRCODE='42501'; END IF;
 ELSIF new.manual_completion_history IS DISTINCT FROM old.manual_completion_history THEN
  IF current_user <> 'service_role' OR coalesce(current_setting('bos.manual_completion_order',true),'') <> old.id::text THEN
   RAISE EXCEPTION 'MANUAL_AUDIT_READ_ONLY' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN new;
END $$;
DROP TRIGGER IF EXISTS bos_guard_manual_completion_audit ON public.orders;
CREATE TRIGGER bos_guard_manual_completion_audit BEFORE INSERT OR UPDATE OF manual_completion_history ON public.orders
 FOR EACH ROW EXECUTE FUNCTION public.guard_manual_completion_audit();

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

-- Custom BOS authentication stays at the existing Edge boundary. Browser roles cannot call this RPC.
CREATE OR REPLACE FUNCTION public.bos_manual_complete_order(
 p_order_id bigint,p_actor_id uuid,p_reason text,p_expected_updated_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
 actor public.business_staff%ROWTYPE;
 target public.orders%ROWTYPE;
 completed timestamptz;
 previous_context text;
 reason text := btrim(coalesce(p_reason,''));
BEGIN
 IF current_user <> 'service_role' THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO actor FROM public.business_staff WHERE id=p_actor_id AND is_active AND role::text IN ('owner','manager') FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','FORBIDDEN'); END IF;
 IF length(reason)=0 OR length(reason)>1000 THEN RETURN jsonb_build_object('ok',false,'error','REASON_REQUIRED'); END IF;
 SELECT * INTO target FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','ORDER_NOT_FOUND'); END IF;
 -- A lost response or simultaneous ordinary completion must never update even the audit/timestamp twice.
 IF target.status::text='Выполнена' THEN RETURN jsonb_build_object('ok',true,'order',to_jsonb(target),'idempotent',true); END IF;
 IF target.status::text='Отменена' THEN RETURN jsonb_build_object('ok',false,'error','ORDER_CANCELLED'); END IF;
 IF target.status::text NOT IN ('В работе','Рекламация') OR p_expected_updated_at IS NULL OR target.updated_at IS DISTINCT FROM p_expected_updated_at THEN
  RETURN jsonb_build_object('ok',false,'error','ORDER_CHANGED');
 END IF;
 completed:=clock_timestamp();
 previous_context:=current_setting('bos.manual_completion_order',true);
 PERFORM set_config('bos.manual_completion_order',target.id::text,true);
 -- Existing completion triggers still run. In particular, report fields are deliberately absent:
 -- bos_hands_capture_report cannot enqueue a report, and saved payroll values stay byte-for-byte intact.
 UPDATE public.orders SET status='Выполнена',completed_at=completed,sync_status='pending_sheet',
  manual_completion_history=target.manual_completion_history || jsonb_build_array(jsonb_build_object(
   'actor_id',actor.id,'actor_name',actor.full_name,'actor_role',actor.role,'at',completed,'reason',reason))
 WHERE id=target.id RETURNING * INTO target;
 PERFORM set_config('bos.manual_completion_order',coalesce(previous_context,''),true);
 RETURN jsonb_build_object('ok',true,'order',to_jsonb(target),'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.bos_manual_complete_order(bigint,uuid,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bos_manual_complete_order(bigint,uuid,text,timestamptz) TO service_role;
