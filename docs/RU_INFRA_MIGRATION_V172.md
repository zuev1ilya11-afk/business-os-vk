# Business OS — RU infrastructure migration v172

## Goal
Move production processing of Russian personal data from foreign infrastructure to infrastructure physically located in Russia without changing Business OS business logic, roles, payroll formulas, or user workflows.

## Selected compatibility strategy
Use self-hosted Supabase on a Russian cloud VM as the first target. This preserves the current PostgreSQL + Storage + Edge Functions model and minimizes application rewrites.

Recommended first deployment target:
- Yandex Cloud, Russia region `ru-central1`; or
- Selectel Russian zones (`ru-*`) if preferred.

For a small/medium production stack start with at least 4 vCPU, 8 GB RAM, 80+ GB SSD and increase after observing load. Put a TLS reverse proxy in front of the Supabase gateway and do not expose PostgreSQL publicly.

Pin the current stable self-hosted Supabase release instead of tracking `latest`. As of this migration preparation, the official Docker self-hosting documentation uses `self-hosted/v0.8.2`. Re-check the official release before provisioning production.

## Current production inventory verified 2026-09-26
- Managed Supabase project: `obsropbslfwtanyspjbi`
- Region: `eu-west-2`
- PostgreSQL: 17.x
- Core data currently includes at least:
  - `orders`: 41 rows
  - `business_staff`: 14 rows
  - `staff_schedule`: 658 rows
  - `order_claims`: 0 rows
  - `staff_invites`: 4 rows
  - Storage: 78 objects
- Active Edge Functions include `mini-app-api`, `password-session-api`, `report-api`, `drive-archive-api`, `avito-api`, `integration-api`, `staff-admin-api`, `staff-invite-api`, `master-workflow-api`, `order-lifecycle-api` and others.

Counts are only sizing indicators; migration must include all production tables, sequences, enums, functions, triggers, policies and storage objects, not just the objects listed above.

## Migration stages

### Stage 0 — no-impact application preparation
Branch: `feat/ru-infra-migration-v172`.

`config.js` now supports an optional HTTPS `window.BOS_RU_API_BASE`. With no value set, the existing production endpoint remains unchanged. `network-direct-v86.js` reads the routing dynamically, so a validated RU endpoint can become primary without editing feature modules.

Do not set `BOS_RU_API_BASE` in production until the RU stack passes the shadow checks below.

### Stage 1 — provision RU Supabase
1. Provision a Russian VM/VPS.
2. Install Docker Engine + Docker Compose.
3. Install the pinned official self-hosted Supabase Docker release.
4. Generate new production secrets; never copy placeholder secrets from examples.
5. Configure public URLs behind HTTPS.
6. Restrict firewall rules: public 443 only; SSH limited to trusted admin addresses; database/internal service ports private.
7. Configure persistent backups stored in Russia.
8. Add monitoring/health alerts.

### Stage 2 — restore schema before data
Restore the complete PostgreSQL schema into the RU database, including:
- tables and sequences;
- enums/types;
- indexes and constraints;
- functions/triggers;
- RLS policies and grants;
- extensions actually used by Business OS.

Do not recreate only `supabase/setup.sql`: the production schema contains later migrations and additional fields.

Run security checks after restore. Internal tables (`business_staff`, `staff_schedule`, `order_claims`, `api_integrations`, etc.) must remain inaccessible directly to `anon` / ordinary authenticated clients if that is the current production contract.

### Stage 3 — migrate data
Use a consistent database snapshot. Preserve IDs and sequence positions. Validate row counts and referential integrity after import.

Do not enable dual writes until idempotency is proven. Orders and Avito messages contain non-idempotent operations and must not be blindly replayed.

### Stage 4 — migrate Storage
Copy all objects from the production storage buckets to RU storage/Supabase Storage while preserving object paths and content types.

Important: existing Supabase signed URLs are tied to the old project and should not become permanent database identifiers. During migration convert report references to stable object paths (or generate fresh signed URLs server-side on demand) before decommissioning the old storage.

### Stage 5 — migrate Edge Functions
Deploy the function sources from this repository to self-hosted Edge Runtime. Configure secrets on the RU host, not in Git.

At minimum verify:
- `mini-app-api`
- `password-session-api`
- `report-api`
- `profile-self-api`
- `employee-meta-api`
- `staff-admin-api`
- `staff-invite-api`
- `claims-api`
- `master-workflow-api`
- `order-lifecycle-api`
- `avito-api`
- `integration-api`

Google Drive/Apps Script archival is a separate foreign-data path. It must be replaced with Russian object storage or otherwise handled as an explicitly compliant cross-border flow before the migration is considered complete.

### Stage 6 — shadow verification
Before switching users:
1. RU `/health` endpoints return healthy.
2. Owner login works.
3. Master login works.
4. Bootstrap data matches production counts/critical values.
5. Create/update one synthetic test order in RU only.
6. Master workflow works on the synthetic order.
7. Report upload/download works in RU storage.
8. Permissions: master cannot read another master's order; dispatcher/manager boundaries still hold.
9. Run server tests and focused Playwright auth/order/report tests.

No real customer data should be entered during synthetic functional checks beyond the controlled migrated snapshot.

### Stage 7 — controlled cutover
Set `window.BOS_RU_API_BASE` to the HTTPS RU gateway before `config.js` executes. The application will route the existing `/api/proxy/<function>` contract to the RU endpoint.

For the initial controlled window, old gateways may remain as fallback for availability, but this is transitional only. A fallback that sends personal data abroad does not satisfy the final localization goal.

Monitor errors, latency, order creation, login, report uploads and storage access.

### Stage 8 — final localization state
After RU production is verified:
- remove direct foreign Supabase fallback from `network-direct-v86.js`;
- remove AppDeploy/Netlify fallback for routes carrying personal data;
- stop Google Drive archival of personal-data-bearing reports or replace it with RU storage;
- rotate credentials that were used by the legacy environment;
- delete or lawfully archive old foreign production copies according to the approved retention/migration procedure;
- update the personal-data operator documentation and Roskomnadzor notification details with the actual Russian database location and subprocessors.

## Rollback rule
Until Stage 8, rollback means switching `BOS_RU_API_BASE` off and returning traffic to the known production route. Do not reverse-replicate test writes from RU into foreign production automatically. If a cutover allows real writes, use a planned maintenance/catch-up procedure so no orders are lost or duplicated.

## Security improvements to schedule with migration
These are separate from endpoint switching and should be changed only with regression coverage:
- reduce 365-day password-session TTL;
- stop storing year-long signed Storage URLs as durable references;
- implement session revocation/versioning;
- define retention and deletion for customer/order/report data;
- replace Google Drive report archival with RU object storage;
- ensure backups and logs containing personal data remain in Russia.

## Definition of done
Migration is complete only when new Russian-client personal data is written and stored first in the Russian production database/storage, the application no longer needs foreign fallback routes for normal operation, report files stay in the approved RU storage path, and the legal/operator documentation reflects the deployed infrastructure.
