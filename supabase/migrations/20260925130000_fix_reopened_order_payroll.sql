-- Keep payroll eligibility aligned with the order's current business status.
-- When a completed order is reopened, completion/review markers must not remain stale.

create or replace function public.guard_order_completion()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
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
