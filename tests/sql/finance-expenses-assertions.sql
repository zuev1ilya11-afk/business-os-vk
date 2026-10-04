DO $$ BEGIN
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.finance_expenses'::regclass) THEN RAISE EXCEPTION 'RLS disabled'; END IF;
 IF has_table_privilege('anon','public.finance_expenses','SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated','public.finance_expenses','SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Direct access granted'; END IF;
 IF NOT has_table_privilege('service_role','public.finance_expenses','SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'API access missing'; END IF;
END $$;
INSERT INTO public.finance_expenses(id,expense_date,amount,category,created_by_staff_id,created_by_name,order_id)
VALUES ('00000000-0000-4000-8000-000000000002','2026-10-04',15000.25,'avito','00000000-0000-4000-8000-000000000001','Тест',1);
DO $$ BEGIN
 BEGIN UPDATE public.finance_expenses SET amount=0; RAISE EXCEPTION 'zero allowed'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE public.finance_expenses SET category='other',comment=''; RAISE EXCEPTION 'empty other allowed'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE public.finance_expenses SET comment=repeat('x',501); RAISE EXCEPTION 'oversized comment allowed'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE public.finance_expenses SET order_id=999; RAISE EXCEPTION 'invalid foreign key allowed'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 IF (SELECT amount FROM public.finance_expenses)<>15000.25 THEN RAISE EXCEPTION 'invalid amount'; END IF;
 IF (SELECT master_payout FROM public.orders WHERE id=1)<>600 THEN RAISE EXCEPTION 'payroll changed'; END IF;
END $$;
-- Even an accidental future SELECT grant cannot expose expense data through RLS.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.finance_expenses TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT FROM public.finance_expenses) THEN RAISE EXCEPTION 'RLS leaks financial data'; END IF;
END $$;
RESET ROLE;
UPDATE public.finance_expenses SET amount=4500,category='tools';
DELETE FROM public.finance_expenses;
DO $$ BEGIN
 IF EXISTS(SELECT FROM public.finance_expenses) THEN RAISE EXCEPTION 'delete failed'; END IF;
 IF (SELECT master_payout FROM public.orders WHERE id=1)<>600 THEN RAISE EXCEPTION 'payroll changed'; END IF;
END $$;
ROLLBACK;
