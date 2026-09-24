# Production Supabase: targeted grants hardening

Base: 43a7a0484a0e457b33b2f492aa86ed8a87ced7e7. Project: obsropbslfwtanyspjbi.

Applied 2026-09-24. Only four tables changed: public.business_staff,
public.staff_schedule, public.order_claims, public.api_integrations.
Production mini-app-api, claims-api and integration-api use service_role.
Revoke PUBLIC/anon/authenticated table privileges; retain existing service_role
privileges and RLS without policies. Existing RLS denied row access already;
this removes unnecessary grants, including privileges not governed by row policies.

Classification / unchanged:
- Server-only: the four tables above; public.staff_invites and
  public.avito_connections already deny effective client privileges.
- Legacy/internal, no client grants: public.users, public.masters, all 13 bos
  tables. No attempt to change their server grants or determine unused status.
- Backups: orders_backup_pre_hands_20260913 and
  order_claims_backup_pre_hands_20260913 already deny effective client privileges.
- Unknown: public.master_schedule (no repository reference), agent schema and
  other Advisor tables; no changes without confirmed consumers.
- Client policy tables public.profiles/public.orders: existing policies unchanged.

Password login in password-session-api uses bos_verify_staff_credentials and
custom sessions, not Supabase Auth password flow. Leaked Password Protection
remains a separate Dashboard step if Supabase Auth passwords are introduced;
it does not protect this custom password implementation.

Validation: rollback rehearsal then applied migration with assertions for
effective client table/column denial, service_role CRUD/BYPASSRLS and unchanged
RLS. Rechecked assertions after application. 38 targeted auth/security/server/
gateway tests passed. Advisor: unchanged 35 RLS-without-policy INFO and one
leaked-password WARN; no new findings. No permissive policy added to silence INFO.
No authenticated employee end-to-end session was available for live UI testing.

PR records the already applied production migration with its production version.
Do not re-run as a separately named migration. No UI/API/auth/payroll changes.
