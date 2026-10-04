-- Extends order-guards-schema.sql, only in a disposable database.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.business_staff(id uuid PRIMARY KEY,full_name text,role text,is_active boolean);
ALTER TABLE public.orders ADD COLUMN sync_status text;
ALTER TABLE public.orders ADD COLUMN amount numeric;
ALTER TABLE public.orders ADD COLUMN original_amount numeric;
ALTER TABLE public.orders ADD COLUMN extra_work_amount numeric;
ALTER TABLE public.orders ADD COLUMN external_source text;
ALTER TABLE public.orders ADD COLUMN source text;
ALTER TABLE public.orders ADD COLUMN master_staff_id uuid;
INSERT INTO public.business_staff VALUES
 ('00000000-0000-0000-0000-000000000001','Владелец','owner',true),
 ('00000000-0000-0000-0000-000000000002','Руководитель','manager',true),
 ('00000000-0000-0000-0000-000000000003','Мастер','master',true),
 ('00000000-0000-0000-0000-000000000004','Диспетчер','dispatcher',true),
 ('00000000-0000-0000-0000-000000000005','Отключённый','owner',false);
INSERT INTO public.orders(id,status,report_review_status,master_workflow_stage,master_started_at,updated_at,amount,original_amount,master_payout,manager_payout,dispatcher_payout,extra_work_amount,external_source,source)
 SELECT i,'В работе','not_submitted','started','2026-10-04T08:00:00Z','2026-10-04T09:00:00Z',1000,1000,123,45,67,50,
 CASE WHEN i%2=0 THEN 'hands' ELSE 'avito' END,CASE WHEN i%2=0 THEN 'Hands' ELSE 'Авито' END FROM generate_series(1,12) i;
CREATE TABLE public.manual_test_effects(order_id integer,kind text);
CREATE FUNCTION public.manual_test_capture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO public.manual_test_effects VALUES(new.id,TG_ARGV[0]); RETURN new;
END $$;
CREATE TRIGGER manual_test_update AFTER UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.manual_test_capture('update');
-- Same UPDATE OF boundary as the real Hands delivery trigger: closure must not touch report columns.
CREATE TRIGGER manual_test_report AFTER UPDATE OF report_review_status,report_upload_token ON public.orders FOR EACH ROW EXECUTE FUNCTION public.manual_test_capture('report');
GRANT USAGE ON SCHEMA public TO service_role,authenticated;
GRANT ALL ON public.orders,public.business_staff,public.manual_test_effects TO service_role;
GRANT SELECT,UPDATE ON public.orders TO authenticated;
