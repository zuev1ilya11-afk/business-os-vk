# Shared help content — RU deployment boundary

This directory is a candidate, not a production release or a runnable production installer.
Do not apply SQL or replace the live edge bundle before separate owner approval.

## Storage and API

Use the **existing RU PostgreSQL** and **existing master-memo-api edge runtime**. No cloud Supabase project or new external service is required. Existing `master_memo_materials` rows/files and their API actions are unchanged.

- `schema.sql` adds only `public.master_help_materials`: permanent text ID, kind, JSON content, integer version, sort order, timestamps and updating staff ID. RLS enabled; PUBLIC/anon/authenticated have no grants. The service role can select/insert/update. This follows the current single-company deployment, not a new multitenant model.
- `seed.sql` inserts 31 initial materials: 10 lessons (39 steps), 6 client situations, 10 FAQ cards and 5 problems. Both removed questions are absent. `ON CONFLICT(id) DO NOTHING` preserves edited rows. Generate/check via `node scripts/help-seed.cjs [--check]`.
- Existing `master-memo-api` session verification and active staff lookup run before new actions. `help_list` returns `{items,can_edit}`; `help_save` accepts `{id,kind,version,content}`. Write roles: exact `owner`, `manager`; other roles rejected. Client role/preview fields are never consulted.
- `help_save`: new row has expected version 0; existing row requires the loaded version; atomic UPDATE filters by ID AND version. Conflict is HTTP 409 with `HELP_CONFLICT`. Exact lost-response retries by the same actor are acknowledged without another row/revision. Image/alt/educational branch data cannot be replaced through the ordinary-fields editor.
- New client requests use only `/functions/v1/master-memo-api` on the current origin; there is no fallback to legacy hosted backends.

## Required before a hosted RU Preview

An authenticated staging execution channel is currently unavailable. A public frontend response does not establish the live backend source/release.

1. Read-only inspect the active RU edge source for master-memo-api and routing, PostgreSQL schema, and deployed web files. Compare to the candidate; preserve RU-specific adaptations. Do not replace the entire site with the repository's GitHub Pages shell.
2. Prepare an isolated test database/runtime using the existing RU architecture; no production orders/staff/financial writes. Apply schema and seed in one transaction to that test database. Re-run seed and confirm edits survive.
3. Compile `master-memo-api/index.ts` with its `help-content.ts` import using the actual edge runtime. Current local tests execute transpiled code, not the RU edge ESZIP compiler.
4. Serve candidate frontend and API on the same **test** origin; test actual login as owner/manager/master, revoked access, direct master API rejection, refresh/re-login, concurrent edits, cached PWA update and mobile devices.
5. Owner reviews this hosted Preview. Only separate approval can authorize production SQL/bundle/frontend changes. Plan backups, exact release checksums and rollback before approval.

The local Preview below demonstrates real HTTP and persisted PostgreSQL-WASM writes with signed synthetic sessions. It does not satisfy the hosted RU runtime/real employee login gate.

## Reproducible local Preview

Requires Node 22.18+ and `npm ci`. Development-only PostgreSQL-WASM dependency is pinned; no additional production dependency.

```
node scripts/qa/help-preview.cjs
```

Open http://127.0.0.1:4188/ on the machine running the command. Choose a synthetic owner/manager/master account. Create or edit in help, then open a second browser session as master. Data persists in the local temporary directory `bos-help-preview` across server restarts. Optional variables: `BOS_HELP_PREVIEW_PORT`, `BOS_HELP_PREVIEW_DATA` (isolated local directory). The server binds loopback only; **do not expose it publicly** because it intentionally issues test-account sessions without production login. It never contacts production or serves real files/orders.

`node scripts/qa/capture-help-editor.cjs` runs an isolated HTTP + PostgreSQL demonstration, restarts the database/server, verifies master visibility and direct API write rejection, and captures evidence. It removes only its own generated temporary database.
