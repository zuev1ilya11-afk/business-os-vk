-- Business OS uses authenticated Edge Functions (service_role) for order reads.
-- This definer view exposed archive links through the unauthenticated Data API.
REVOKE ALL ON public.order_closure_status FROM PUBLIC, anon, authenticated;
-- Keep backend access explicit; no order or payroll data changes.
GRANT SELECT ON public.order_closure_status TO service_role;
