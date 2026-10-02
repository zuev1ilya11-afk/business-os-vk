SELECT pg_temp.check_contract(master_called_at='2020-01-01'::timestamptz AND master_called_by_staff_id IS NULL AND master_called_by_name IS NULL,'migration must not claim legacy contact') FROM public.orders WHERE id=1;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  UPDATE public.orders SET master_called_by_staff_id=master_staff_id,master_called_by_name='fake' WHERE id=1;
  RAISE EXCEPTION 'authenticated caller forged contact';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN
  INSERT INTO public.orders(id,status,master_staff_id,master_called_by_staff_id,master_called_by_name) VALUES(3,'В работе','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','fake');
  RAISE EXCEPTION 'insert forged contact';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.orders SET master_called_by_staff_id='00000000-0000-0000-0000-000000000002',master_called_by_name='fake' WHERE id=1;
  RAISE EXCEPTION 'foreign author accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
UPDATE public.orders SET master_called_by_staff_id=master_staff_id,master_called_at='2000-01-01',master_called_by_name='fake' WHERE id=1;
SELECT pg_temp.check_contract(master_called_at>=transaction_timestamp() AND master_called_by_staff_id='00000000-0000-0000-0000-000000000001' AND master_called_by_name='Первый мастер','server must set clock and original author') FROM public.orders WHERE id=1;
CREATE TEMP TABLE contact_receipt AS SELECT master_called_at,master_called_by_staff_id,master_called_by_name FROM public.orders WHERE id=1;
UPDATE public.business_staff SET full_name='Новое имя' WHERE id='00000000-0000-0000-0000-000000000001';
UPDATE public.orders SET master_staff_id='00000000-0000-0000-0000-000000000002',master_called_at=null,master_called_by_staff_id=null,master_called_by_name=null WHERE id=1;
UPDATE public.orders SET master_called_at=clock_timestamp(),master_called_by_staff_id=master_staff_id,master_called_by_name='Второй мастер' WHERE id=1;
-- The captured live report guard clears legacy calls. The later contact guard
-- must restore verified first contact without changing any report/stage rules.
UPDATE public.orders SET report_review_status='rejected',report_review_comment='Исправьте фото' WHERE id=1;
SELECT pg_temp.check_contract(o.master_called_at=r.master_called_at AND o.master_called_by_staff_id=r.master_called_by_staff_id AND o.master_called_by_name=r.master_called_by_name AND o.master_workflow_stage='assigned' AND o.report_review_status='rejected','reassignment/retry/report reset must preserve first contact') FROM public.orders o CROSS JOIN contact_receipt r WHERE o.id=1;
UPDATE public.orders SET status='Отменена' WHERE id=1;
UPDATE public.orders SET status='В работе',master_called_at=null WHERE id=1;
DELETE FROM public.business_staff WHERE id='00000000-0000-0000-0000-000000000001';
SELECT pg_temp.check_contract(o.master_called_at=r.master_called_at AND o.master_called_by_staff_id=r.master_called_by_staff_id AND o.master_called_by_name=r.master_called_by_name,'import restart and deleted author must retain provenance') FROM public.orders o CROSS JOIN contact_receipt r WHERE o.id=1;
UPDATE public.orders SET master_staff_id='00000000-0000-0000-0000-000000000003' WHERE id=2;
DO $$ BEGIN
 BEGIN
  UPDATE public.orders SET master_called_by_staff_id=master_staff_id,master_called_by_name='fake' WHERE id=2;
  RAISE EXCEPTION 'dispatcher accepted as author';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
UPDATE public.orders SET master_staff_id='00000000-0000-0000-0000-000000000002' WHERE id=2;
UPDATE public.business_staff SET is_active=false WHERE id='00000000-0000-0000-0000-000000000002';
DO $$ BEGIN
 BEGIN
  UPDATE public.orders SET master_called_by_staff_id=master_staff_id,master_called_by_name='fake' WHERE id=2;
  RAISE EXCEPTION 'inactive master accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
