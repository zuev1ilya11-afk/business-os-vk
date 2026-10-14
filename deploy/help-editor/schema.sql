-- Apply only to the existing RU PostgreSQL, in a reviewed release transaction.
-- Isolated storage: no changes to staff, orders, reports, payroll or files.
CREATE TABLE IF NOT EXISTS public.master_help_materials (
 id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_-]{1,79}$'),
 kind text NOT NULL CHECK (kind IN ('lessons','talk','faq','problems')),
 content jsonb NOT NULL CHECK (jsonb_typeof(content)='object' AND content->>'id'=id),
 version integer NOT NULL DEFAULT 1 CHECK (version>0),
 sort_order integer NOT NULL DEFAULT 1000,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by text
);
ALTER TABLE public.master_help_materials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.master_help_materials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.master_help_materials TO service_role;
-- Browser roles have no table access. The existing API verifies the signed
-- BOS session and queries the active staff role before any write.
