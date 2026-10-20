BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
LOCK TABLE public.orders IN SHARE ROW EXCLUSIVE MODE;
REVOKE ALL ON FUNCTION public.bos_import_lemana_order(uuid,jsonb) FROM service_role;
CREATE OR REPLACE FUNCTION public.bos_lemana_297_paused_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF (new.work_items IS NOT NULL OR new.lemana_import_meta IS NOT NULL
  OR lower(btrim(coalesce(new.source,''))) IN ('лемана про','lemana_pro') OR new.external_source='lemana_pro')
  OR (TG_OP='UPDATE' AND (old.work_items IS NOT NULL OR old.lemana_import_meta IS NOT NULL
  OR lower(btrim(coalesce(old.source,''))) IN ('лемана про','lemana_pro') OR old.external_source='lemana_pro'))
 THEN RAISE EXCEPTION 'LEMANA_RELEASE_PAUSED' USING ERRCODE='55000'; END IF;
 RETURN new;
END $$;
REVOKE ALL ON FUNCTION public.bos_lemana_297_paused_guard() FROM public,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS aaa_bos_lemana_297_paused ON public.orders;
CREATE TRIGGER aaa_bos_lemana_297_paused BEFORE INSERT OR UPDATE ON public.orders
 FOR EACH ROW EXECUTE FUNCTION public.bos_lemana_297_paused_guard();
SELECT json_build_object('dependent',exists(SELECT 1 FROM public.orders WHERE work_items IS NOT NULL
 OR lemana_import_meta IS NOT NULL OR lower(btrim(coalesce(source,''))) IN ('лемана про','lemana_pro') OR external_source='lemana_pro'));
NOTIFY pgrst,'reload schema';
COMMIT;
