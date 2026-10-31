-- A reclamation is another visit, not another accrual for the original work.
-- Keep the original financial record outside the mutable operational order.
CREATE TABLE IF NOT EXISTS public.order_financial_snapshots (
 order_id bigint PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
 financial_data jsonb NOT NULL CHECK (jsonb_typeof(financial_data)='object'),
 captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 basis text NOT NULL DEFAULT 'before_first_claim'
);
ALTER TABLE public.order_financial_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_financial_snapshots FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.order_financial_snapshots TO service_role;
COMMENT ON TABLE public.order_financial_snapshots IS 'Immutable original financial event captured before first reclamation; no attachments or customer contacts. Legacy repairs require verified historical evidence.';

CREATE OR REPLACE FUNCTION public.bos_capture_claim_finance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF old.status='Выполнена' AND coalesce(old.is_claim,false)=false
    AND (coalesce(new.is_claim,false)=true OR new.status='Рекламация') THEN
  INSERT INTO public.order_financial_snapshots(order_id,financial_data)
  SELECT old.id,jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(old))
  WHERE key=ANY(ARRAY['id','order_number','external_id','external_source','source','status',
   'completed_at','report_reviewed_at','scheduled_date','created_at','received_date','master_agreed_at',
   'master_staff_id','master_id','master_name','address','city','amount','original_amount',
   'master_payout','extra_work_amount','extra_work_description','uncompleted_work_amount',
   'uncompleted_work_description','uncompleted_work_items','work','work_items','manual_completion_history'])
  ON CONFLICT (order_id) DO NOTHING;
 END IF;
 IF coalesce(new.is_claim,false) AND new.status='Выполнена' AND old.status IS DISTINCT FROM 'Выполнена' THEN
  new.claim_closed_at:=coalesce(new.claim_closed_at,new.completed_at,new.report_reviewed_at,clock_timestamp());
 END IF;
 RETURN new;
END $$;
REVOKE ALL ON FUNCTION public.bos_capture_claim_finance() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS bos_capture_claim_finance ON public.orders;
CREATE TRIGGER bos_capture_claim_finance BEFORE UPDATE ON public.orders
 FOR EACH ROW EXECUTE FUNCTION public.bos_capture_claim_finance();

CREATE OR REPLACE FUNCTION public.bos_close_claim_after_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF coalesce(new.is_claim,false) AND new.status='Выполнена' AND old.status IS DISTINCT FROM 'Выполнена' THEN
  UPDATE public.order_claims SET status='closed',closed_at=new.claim_closed_at
  WHERE order_id=new.id AND status='open' AND opened_at<=new.claim_closed_at;
 END IF;
 RETURN new;
END $$;
REVOKE ALL ON FUNCTION public.bos_close_claim_after_completion() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS bos_close_claim_after_completion ON public.orders;
CREATE TRIGGER bos_close_claim_after_completion AFTER UPDATE ON public.orders
 FOR EACH ROW EXECUTE FUNCTION public.bos_close_claim_after_completion();

-- Do not fabricate dates or snapshot already reopened orders here. Their old
-- report/completion dates may already have been overwritten by the old trigger.
NOTIFY pgrst, 'reload schema';
