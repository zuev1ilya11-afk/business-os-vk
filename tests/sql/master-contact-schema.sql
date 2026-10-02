-- Appends to order-guards-schema.sql in the same disposable transaction.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.business_staff(id uuid PRIMARY KEY,full_name text,role text,is_active boolean);
ALTER TABLE public.orders ADD COLUMN master_staff_id uuid;
INSERT INTO public.business_staff VALUES
 ('00000000-0000-0000-0000-000000000001','Первый мастер','master',true),
 ('00000000-0000-0000-0000-000000000002','Второй мастер','master',true),
 ('00000000-0000-0000-0000-000000000003','Диспетчер','dispatcher',true);
INSERT INTO public.orders(id,status,master_staff_id,master_workflow_stage,master_called_at) VALUES
 (1,'В работе','00000000-0000-0000-0000-000000000001','assigned','2020-01-01'),
 (2,'В работе','00000000-0000-0000-0000-000000000001','assigned',null);

GRANT USAGE ON SCHEMA public TO authenticated,service_role;
GRANT SELECT,UPDATE ON public.orders TO authenticated;
GRANT ALL ON public.orders,public.business_staff TO service_role;
