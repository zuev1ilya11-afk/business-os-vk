SELECT json_build_object('md5',md5(p.prosrc),'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid))
 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE t.tgrelid='public.orders'::regclass AND t.tgname='bos_hands_capture_report'
 AND n.nspname='bos_hands_private' AND p.proname='capture_report'
