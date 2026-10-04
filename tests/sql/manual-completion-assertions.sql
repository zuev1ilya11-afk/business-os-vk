SELECT pg_temp.check_contract(to_regprocedure('public.bos_manual_complete_order(bigint,uuid,text,timestamp with time zone)') IS NOT NULL,'manual completion transaction exists');
SET LOCAL ROLE service_role;
DO $$ DECLARE r jsonb; before_row jsonb; after_row jsonb; BEGIN
 SELECT to_jsonb(o) INTO before_row FROM public.orders o WHERE id=1;
 r:=public.bos_manual_complete_order(1,'00000000-0000-0000-0000-000000000001','Мастер не может отправить отчёт','2026-10-04T09:00:00Z');
 IF r->>'ok'<>'true' OR r->'order'->>'status'<>'Выполнена' THEN RAISE EXCEPTION 'Manual completion failed: %',r; END IF;
 SELECT to_jsonb(o) INTO after_row FROM public.orders o WHERE id=1;
 IF before_row-ARRAY['status','completed_at','updated_at','sync_status','manual_completion_history'] <> after_row-ARRAY['status','completed_at','updated_at','sync_status','manual_completion_history'] THEN RAISE EXCEPTION 'Completion changed report, workflow or finance'; END IF;
 IF after_row->'manual_completion_history'->0->>'actor_name'<>'Владелец' OR after_row->'manual_completion_history'->0->>'reason'<>'Мастер не может отправить отчёт' THEN RAISE EXCEPTION 'Audit missing'; END IF;
 r:=public.bos_manual_complete_order(1,'00000000-0000-0000-0000-000000000002','Повтор после потери сети','2026-10-04T09:00:00Z');
 IF r->>'idempotent'<>'true' OR (SELECT to_jsonb(o) FROM public.orders o WHERE id=1)<>after_row THEN RAISE EXCEPTION 'Retry mutated order'; END IF;
 IF (SELECT count(*) FROM public.manual_test_effects WHERE order_id=1)<>1 THEN RAISE EXCEPTION 'Completion side effects repeated or fake report emitted'; END IF;
END $$;
DO $$ DECLARE r jsonb; actor uuid; reason text; BEGIN
 FOREACH actor IN ARRAY ARRAY['00000000-0000-0000-0000-000000000003'::uuid,'00000000-0000-0000-0000-000000000004'::uuid,'00000000-0000-0000-0000-000000000005'::uuid] LOOP
  r:=public.bos_manual_complete_order(2,actor,'Проверено','2026-10-04T09:00:00Z');IF r->>'error'<>'FORBIDDEN' THEN RAISE EXCEPTION 'Unauthorized actor allowed'; END IF;
 END LOOP;
 FOREACH reason IN ARRAY ARRAY['','  ',repeat('a',1001)] LOOP
  r:=public.bos_manual_complete_order(2,'00000000-0000-0000-0000-000000000001',reason,'2026-10-04T09:00:00Z');IF r->>'error'<>'REASON_REQUIRED' THEN RAISE EXCEPTION 'Invalid reason accepted'; END IF;
 END LOOP;
 r:=public.bos_manual_complete_order(2,'00000000-0000-0000-0000-000000000001','Проверено','2026-10-03T09:00:00Z');IF r->>'error'<>'ORDER_CHANGED' THEN RAISE EXCEPTION 'Stale snapshot allowed'; END IF;
END $$;
-- An actual uploaded report stays intact; a completion does not approve/send it.
UPDATE public.orders SET report_uploaded_at=now(),report_act_url='real-act',report_photo_urls='["real-photo"]',report_upload_token='real-token',report_review_status='pending',master_payout=0 WHERE id=3;
DO $$ DECLARE r jsonb; before_row jsonb; stamp timestamptz; BEGIN
 SELECT to_jsonb(o),updated_at INTO before_row,stamp FROM public.orders o WHERE id=3;
 r:=public.bos_manual_complete_order(3,'00000000-0000-0000-0000-000000000002','Проверено',stamp);
 IF r->>'ok'<>'true' OR before_row-ARRAY['status','completed_at','updated_at','sync_status','manual_completion_history'] <> (r->'order')-ARRAY['status','completed_at','updated_at','sync_status','manual_completion_history'] THEN RAISE EXCEPTION 'Existing report or zero payout changed'; END IF;
END $$;
UPDATE public.orders SET status='Отменена' WHERE id=4;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.bos_manual_complete_order(4,'00000000-0000-0000-0000-000000000001','Проверено',(SELECT updated_at FROM public.orders WHERE id=4));IF r->>'error'<>'ORDER_CANCELLED' THEN RAISE EXCEPTION 'Cancelled completion allowed'; END IF;
 BEGIN UPDATE public.orders SET status='Выполнена' WHERE id=5; RAISE EXCEPTION 'unguarded completion'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'REPORT_REQUIRED_BEFORE_COMPLETION' THEN RAISE; END IF; END;
 BEGIN UPDATE public.orders SET manual_completion_history='[{"reason":"forged"}]' WHERE id=5; RAISE EXCEPTION 'audit editable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
-- A normal completion just before the request wins; the manual request stays read-only.
UPDATE public.orders SET report_uploaded_at=now(),report_act_url='real-act',report_photo_urls='["real-photo"]',report_review_status='approved',status='Выполнена',completed_at=now() WHERE id=6;
DO $$ DECLARE r jsonb; old_row jsonb; BEGIN
 SELECT to_jsonb(o) INTO old_row FROM public.orders o WHERE id=6;
 r:=public.bos_manual_complete_order(6,'00000000-0000-0000-0000-000000000001','Проверено','2026-10-04T09:00:00Z');
 IF r->>'idempotent'<>'true' OR old_row<>(r->'order') THEN RAISE EXCEPTION 'Normal completion overwritten'; END IF;
END $$;
-- Reopening through the existing workflow keeps earlier audit events. A new closure
-- appends an event without rewriting history or recalculating the stored payouts.
UPDATE public.orders SET status='В работе' WHERE id=1;
DO $$ DECLARE r jsonb; old_history jsonb; old_stamp timestamptz; BEGIN
 SELECT manual_completion_history,updated_at INTO old_history,old_stamp FROM public.orders WHERE id=1;
 IF jsonb_array_length(old_history)<>1 OR (SELECT completed_at FROM public.orders WHERE id=1) IS NOT NULL THEN RAISE EXCEPTION 'Reopening lost audit or retained completed status'; END IF;
 r:=public.bos_manual_complete_order(1,'00000000-0000-0000-0000-000000000002','Повторная проверка',old_stamp);
 IF r->>'ok'<>'true' OR jsonb_array_length(r->'order'->'manual_completion_history')<>2 OR r->'order'->'manual_completion_history'->0<>old_history->0 THEN RAISE EXCEPTION 'Second closure rewrote history'; END IF;
 r:=public.bos_manual_complete_order(2,'00000000-0000-0000-0000-000000000001','Проверено',NULL);
 IF r->>'error'<>'ORDER_CHANGED' THEN RAISE EXCEPTION 'Missing version accepted'; END IF;
END $$;
-- Other sources use exactly the same stored-finance-preserving transition.
UPDATE public.orders SET source=CASE id WHEN 7 THEN 'Внутренняя' ELSE 'Другое' END WHERE id IN (7,8);
DO $$ DECLARE target bigint; before_row jsonb; r jsonb; stamp timestamptz; BEGIN
 FOREACH target IN ARRAY ARRAY[7,8] LOOP
  SELECT to_jsonb(o),updated_at INTO before_row,stamp FROM public.orders o WHERE id=target;
  r:=public.bos_manual_complete_order(target,'00000000-0000-0000-0000-000000000001','Проверено',stamp);
  IF r->>'ok'<>'true' OR before_row-ARRAY['status','completed_at','updated_at','sync_status','manual_completion_history']<>(r->'order')-ARRAY['status','completed_at','updated_at','sync_status','manual_completion_history'] THEN RAISE EXCEPTION 'Source-specific completion changed finance or report'; END IF;
 END LOOP;
END $$;
RESET ROLE;
SELECT pg_temp.check_contract(NOT has_function_privilege('anon','public.bos_manual_complete_order(bigint,uuid,text,timestamptz)','EXECUTE') AND NOT has_function_privilege('authenticated','public.bos_manual_complete_order(bigint,uuid,text,timestamptz)','EXECUTE'),'direct RPC denied');
ROLLBACK;
