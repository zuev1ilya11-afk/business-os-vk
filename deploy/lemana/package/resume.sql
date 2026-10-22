BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
LOCK TABLE public.orders IN SHARE ROW EXCLUSIVE MODE;
DROP TRIGGER aaa_bos_lemana_297_paused ON public.orders;
DROP FUNCTION public.bos_lemana_297_paused_guard();
GRANT EXECUTE ON FUNCTION public.bos_import_lemana_order(uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
