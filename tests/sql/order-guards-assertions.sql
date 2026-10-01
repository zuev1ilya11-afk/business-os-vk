INSERT INTO public.orders(id,status,report_review_status,master_workflow_stage,master_payout,manager_payout,dispatcher_payout)
 VALUES (1,'В работе','not_submitted','started',552.5,159.8,119.85);
DO $$BEGIN
 BEGIN UPDATE public.orders SET status='Выполнена' WHERE id=1; RAISE EXCEPTION 'completion unexpectedly accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'REPORT_REQUIRED_BEFORE_COMPLETION' THEN RAISE; END IF; END;
END$$;
UPDATE public.orders SET report_type='measurement',report_act_url='act',report_photo_urls='["photo"]',report_uploaded_at=now(),report_upload_token='first' WHERE id=1;
DO $$BEGIN
 BEGIN UPDATE public.orders SET status='Выполнена' WHERE id=1; RAISE EXCEPTION 'measurement unexpectedly accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'MEASUREMENT_REPORT_REQUIRED' THEN RAISE; END IF; END;
END$$;
UPDATE public.orders SET report_type='work',report_review_status='pending',master_called_at=now(),master_agreed_at=now(),master_departed_at=now(),master_started_at=now(),drive_archive_status='done',drive_archive_url='archive' WHERE id=1;
UPDATE public.orders SET report_review_status='rejected',report_review_comment='Fix photo',report_reviewed_by='dispatcher',report_reviewed_at=now() WHERE id=1;
SELECT pg_temp.check_contract(master_workflow_stage='assigned' AND master_called_at IS NULL AND master_agreed_at IS NULL AND master_departed_at IS NULL AND master_started_at IS NULL AND report_uploaded_at IS NULL AND report_act_url IS NULL AND report_upload_token IS NULL AND report_photo_urls='[]' AND drive_archive_status='pending' AND drive_archive_url IS NULL AND report_review_status='rejected' AND report_review_comment='Fix photo' AND report_reviewed_by='dispatcher' AND master_payout=552.5,'rejection restarts work, clears files, preserves reason and saved payout') FROM public.orders WHERE id=1;
-- Report submitted after the repeated workflow must survive unchanged status.
UPDATE public.orders SET master_workflow_stage='started',report_type='work',report_uploaded_at=now(),report_act_url='new-act',report_photo_urls='["new-photo"]',report_upload_token='second',report_review_status='pending',status='В работе' WHERE id=1;
SELECT pg_temp.check_contract(report_upload_token='second' AND report_act_url='new-act','resubmission survives guard') FROM public.orders WHERE id=1;
UPDATE public.orders SET status='Выполнена',report_review_status='approved',completed_at=now() WHERE id=1;
UPDATE public.orders SET report_review_status='approved' WHERE id=1;
SELECT pg_temp.check_contract(status='Выполнена' AND report_upload_token='second' AND completed_at IS NOT NULL,'approval and repeated approval preserve completion') FROM public.orders WHERE id=1;
UPDATE public.orders SET status='В работе' WHERE id=1;
SELECT pg_temp.check_contract(report_review_status='not_submitted' AND report_review_comment='' AND report_upload_token IS NULL AND completed_at IS NULL AND master_workflow_stage='assigned' AND master_payout=552.5,'reopen resets workflow without recalculating history') FROM public.orders WHERE id=1;
UPDATE public.orders SET status='Отменена',master_payout=10,manager_payout=20,dispatcher_payout=30 WHERE id=1;
SELECT pg_temp.check_contract(master_payout=0 AND manager_payout=0 AND dispatcher_payout=0 AND updated_at IS NOT NULL,'cancel update zeroes all payouts and touches version') FROM public.orders WHERE id=1;
INSERT INTO public.orders(id,status,master_payout,manager_payout,dispatcher_payout) VALUES(2,'Отменена',10,20,30);
UPDATE public.orders SET master_payout=42 WHERE id=2;
SELECT pg_temp.check_contract(master_payout=0 AND manager_payout=0 AND dispatcher_payout=0,'cancel insert and later payout edit remain zero') FROM public.orders WHERE id=2;
SELECT pg_temp.check_contract(uncompleted_work_items IS NULL,'legacy rows remain without item details') FROM public.orders WHERE id=1;
UPDATE public.orders SET uncompleted_work_items='[{"service_id":"standard_016","quantity":1.25,"unit_price":300,"amount":375}]' WHERE id=1;
SELECT pg_temp.check_contract(jsonb_array_length(uncompleted_work_items)=1,'report item snapshot persists') FROM public.orders WHERE id=1;
DO $$BEGIN
 BEGIN UPDATE public.orders SET uncompleted_work_items='{}' WHERE id=1; RAISE EXCEPTION 'invalid item container accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END$$;
ROLLBACK;
SELECT 'order trigger integration: PASS' AS result;
