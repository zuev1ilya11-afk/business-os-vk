SELECT pg_temp.assert(NOT has_schema_privilege('anon','bos_avito_private','USAGE'),'anon schema');
SELECT pg_temp.assert(NOT has_function_privilege('authenticated','public.bos_avito_assistant(text,jsonb)','EXECUTE'),'authenticated RPC');
SELECT pg_temp.assert(NOT has_function_privilege('anon','public.bos_avito_assistant(text,jsonb)','EXECUTE'),'anon RPC');
SELECT pg_temp.assert((SELECT bool_and(relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='bos_avito_private' AND c.relkind='r'),'private RLS');
SET LOCAL ROLE service_role;
DO $$
DECLARE l jsonb; a jsonb; d jsonb; s jsonb; first_id uuid; order_id bigint;
BEGIN
 PERFORM pg_temp.assert(public.bos_avito_assistant('claim') IS NULL,'disabled claims');
 UPDATE bos_avito_private.runtime SET enabled=true,started_at=now();
 l:=public.bos_avito_assistant('claim');PERFORM pg_temp.assert(l->>'lease' IS NOT NULL,'claim granted');
 PERFORM pg_temp.assert(public.bos_avito_assistant('claim') IS NULL,'one worker at a time');
 a:=jsonb_build_object('lease',l->>'lease','account','42','chat','chat-1');
 d:=public.bos_avito_assistant('load',a);PERFORM pg_temp.assert(d->'state'->>'status'='active','new conversation');
 BEGIN PERFORM public.bos_avito_assistant('budget',jsonb_build_object('lease','wrong'));
  RAISE EXCEPTION 'wrong lease accepted';EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'STALE_LEASE' THEN RAISE;END IF;END;
 BEGIN PERFORM public.bos_avito_assistant('create_order',a);
  RAISE EXCEPTION 'unconfirmed order accepted';EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'CONFIRMATION_REQUIRED' THEN RAISE;END IF;END;
 first_id:=(public.bos_avito_assistant('reserve_send',a||'{"input_id":"m1","body":"Проверьте данные"}')#>>'{}')::uuid;
 PERFORM pg_temp.assert(first_id IS NOT NULL,'reserve send');
 PERFORM pg_temp.assert(public.bos_avito_assistant('reserve_send',a||'{"input_id":"m1","body":"Дубликат"}') IS NULL,'duplicate input cannot send');
 d:=public.bos_avito_assistant('load',a);PERFORM pg_temp.assert((d->>'uncertain')::boolean,'crashed send remains uncertain');
 PERFORM public.bos_avito_assistant('finish_send',a||jsonb_build_object('id',first_id,'message_id','bot-1'));
 s:='{"status":"awaiting_confirmation","summary":"Цена от 1000, желаемое завтра. Уточнение цены и времени до выезда.","summary_message_id":"bot-1","fields":{"name":"Клиент","phone":"+79991234567","region":"Санкт-Петербург","settlement":"Санкт-Петербург","address":"Адрес","work":"Замена смесителя"}}';
 PERFORM public.bos_avito_assistant('save',a||jsonb_build_object('state',s));
 order_id:=(public.bos_avito_assistant('create_order',a||'{"item_id":"123","item_url":"javascript:bad"}')#>>'{}')::bigint;
 PERFORM pg_temp.assert(order_id IS NOT NULL,'confirmed request creates order');
 PERFORM pg_temp.assert((SELECT status='Новая' AND source='Авито' AND amount=0 AND master_payout=0 AND master_staff_id IS NULL AND scheduled_date IS NULL AND avito_item_url IS NULL FROM public.orders WHERE id=order_id),'only intake, no invented totals or booking');
 -- A competing manual creation uses the same existing unique key and must win unchanged.
 PERFORM public.bos_avito_assistant('save',a||jsonb_build_object('state',s));
 UPDATE public.orders SET amount=3456,comment='Диспетчер уточнил' WHERE id=order_id;
 PERFORM pg_temp.assert((public.bos_avito_assistant('create_order',a)#>>'{}')::bigint=order_id,'existing order wins');
 PERFORM pg_temp.assert((SELECT count(*)=1 FROM public.orders),'no duplicate orders');
 PERFORM pg_temp.assert((SELECT amount=3456 AND comment='Диспетчер уточнил' FROM public.orders WHERE id=order_id),'existing business data untouched');
 UPDATE bos_avito_private.runtime SET ai_calls=daily_limit;
 PERFORM pg_temp.assert(public.bos_avito_assistant('budget',a)='false'::jsonb,'daily model budget');
 UPDATE bos_avito_private.runtime SET sends=daily_limit;
 PERFORM pg_temp.assert(public.bos_avito_assistant('reserve_send',a||'{"input_id":"m2","body":"Ещё"}') IS NULL,'daily send budget');
 UPDATE bos_avito_private.runtime SET enabled=false;
 BEGIN PERFORM public.bos_avito_assistant('save',a||jsonb_build_object('state',s));
  RAISE EXCEPTION 'disabled write accepted';EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'ASSISTANT_DISABLED' THEN RAISE;END IF;END;
 PERFORM public.bos_avito_assistant('release',a||'{"offset":100}');
 PERFORM pg_temp.assert((SELECT lease IS NULL FROM bos_avito_private.runtime),'lease released while disabled');
END $$;
RESET ROLE;
ROLLBACK;
