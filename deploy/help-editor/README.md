# Shared help content — RU deployment boundary

This directory contains the help editor candidate and the pinned RU installer
`bos293.pyz`. Production activation still requires a successful on-host
`--prepare` and separate owner approval after Preview. The first on-host
preparation stopped at disposable PostgreSQL startup; production activation has
not started. Do not apply raw SQL or copy the generic repo shell.

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

## Read-only check on the existing RU server

`python3 check_server.py` prints only the active build, hashes of help assets and
master-memo source/bundle, container image identifiers, and relevant database
metadata. The SQL runs inside `BEGIN READ ONLY` and ends with `ROLLBACK`.
It never prints environment values, source contents, employee identities or
customer data; it does not modify files, database rows or services. A missing or
unexpected layout stops the check. This command is **not an installer**: its output
is needed to prepare the exact server-compatible release and rollback package.
Local safety checks: `python3 deploy/help-editor/test_check_server.py` (12 tests).

Observed RU memo source SHA-256:
`5825b23c65e501bced7e7fe3bfe4bbc173e1bea3908365c39f43920acff0ec75`.
It matches the previously captured production inventory. A byte-identical source
copy was retrieved and compared: its difference from the repository baseline is
only a line break before the final UNKNOWN_ACTION return and the final newline.
No authentication or memo behavior differs. The existing source formatting must
still be retained by the RU release patch.

`python3 check_server.py --brief` produces a short console report. It follows the
existing RU release route used by `scripts/ru-hands-intake-check.py`: active edge
name, `BOS_REST_ORIGIN`, the matching release REST container and its `PGRST_DB_URI`,
then the matching release PostgreSQL container. Each hostname must resolve
uniquely on the caller's Docker networks. Image names are not used: pinned image
IDs and custom image tags are valid. Foreign/ambiguous targets, URI overrides,
unexpected ports and missing routes stop before any database query. There is no
fallback to the container's bootstrap database.

The configured database user/password stay inside the PostgreSQL container.
Queries run read-only with a five-second statement timeout. Only a safe SQLSTATE
is returned on failure, never credentials or raw errors. Twelve focused tests
cover read-only operation, redaction, pinned images, the live database selection
and refusal of an unverified route.

The previous checker reported `SQLSTATE_42P01` with `DB_TARGET=container default`
on the owner's server. That report does not establish the state of the application
database. The revised checker must report `DB_TARGET=verified active release`
before its schema/role metadata can be used to prepare a deployment.

## Pinned RU package

The owner's latest read-only report confirmed PostgreSQL 17.11, the verified
active release route, `owner/manager/master/dispatcher`, the absent help table,
and existing memo columns (UUID ID, category/title/note and file metadata).
Structured help therefore uses one new table; existing memo rows/files stay intact.

`bos293.pyz` upgrades only RU build `05f9f54b55a82dd2eff6` to
`4960149db306fca8149a`. It preserves all unrelated RU startup sources, the gateway
and previously published push/mobile changes. `release-manifest.json` lists exact
file hashes. The API helper is inlined into the one existing memo source target;
removing only that helper and dispatch yields the exact observed RU baseline hash.

- `python3 /root/bos293.pyz --check`: read-only checks, including an already active release.
- `python3 /root/bos293.pyz --prepare`: private full web/API backups, baseline ESZIP rebuild/hash comparison, isolated candidate compile, then disposable RU PostgreSQL/PostgREST/edge tests using signed synthetic roles. All test services share a loopback-only network namespace, without production credentials/data/ports. It restarts only test containers. Production remains unchanged.
- `python3 /root/bos293.pyz --apply`: requires successful preparation; creates and seeds the help table in one guarded transaction, reloads the existing PostgREST schema, updates only the memo API and web candidate, verifies public file hashes and existing authentication rejection. Run only after approval.
- `python3 /root/bos293.pyz --rollback`: validates both backups and current hashes before restoring previous web/API; refuses later unrelated deployments. **Retains the help table and employee edits.** Reprepare/reapply uses the saved ownership marker and does not reseed retained data.

Private staging/backups are under `/opt/business-os/deploy/help293`,
`help293-api`, and `help293-web`. Failed preparation can be retried; old attempts
are archived. The canonical table ownership journal remains available even if
reprepare is interrupted. No production keys or employee identities are printed.
Initial dependency download during the baseline compiler run uses a temporary
container without credentials; it is disconnected before candidate compilation.

Build with the verified previous RU source directory:
`python3 deploy/help-editor/build_package.py /path/to/05f9-RU-source`.
The generator refuses any mismatching baseline input and checks that unrelated
startup sources, eager bundle, index structure and service worker are preserved.

Executed locally: 12 filesystem activation/rollback/retry tests; 12 read-only
route/redaction tests; 31 assertions from the **packaged** signed HTTP probes
against the **packaged** API and disk-backed PostgreSQL, including restart,
repeat seed, CAS conflict and direct master rejection. No Docker runtime is
available in this workspace, so the actual RU ESZIP/PostgREST launch is deliberately
a required `--prepare` gate, not a claimed local success. The disposable runtime
does not replace the outstanding real employee and hosted Preview checks.

### Observed preparation stop (15 October)

The owner's console reached the isolated-runtime phase after the baseline bundle
comparison and candidate build, then stopped with `Help database query failed`.
Production activation had not started. The earlier probe removed its temporary
container before retaining the PostgreSQL startup error, so the root cause is
not established by that message.

`diagnose_pg.py` is a separate diagnostic for this exact failed candidate
(installer SHA-256 pinned in the script). It checks the saved baseline read-only,
starts only a new disposable PostgreSQL with the same image/configuration/limits,
and prints bounded, redacted errors from that test container. It runs the packaged
synthetic fixture only in that new database. It does not rebuild the API, change
the installer, alter old backups/journals, apply live SQL or restart live services.
Its own temporary container is removed even if log collection is interrupted.
Five focused fixture/hash, redaction, bounds, synthetic SQL-target and interrupted
cleanup tests pass locally; synthetic psql errors use normal diagnostic verbosity;
the subsequent on-host diagnostic result is recorded below.

### Disposable PostgreSQL path correction (15 October)

The on-host diagnostic then reported `FAILED_PHASE=startup`, `EXIT=1`,
`OOM=False` and `FATAL: data directory "/var/lib/postgresql/data" has invalid
permissions`. The test had set PGDATA and mounted its fresh 0700 directory at
`/var/lib/postgresql/help-preview`, while the server still used the image's
default data directory. The probe now aligns both PGDATA and the **private test
bind destination** with `/var/lib/postgresql/data`. It does not chmod/chown or
mount any production directory. The original image, network isolation, random
test credentials, resource limits, fixture and production payload are unchanged.

`test_probe_storage.py` failed on the old path and passes with the corrected
launch configuration; Docker is intercepted in this regression test. The
standalone diagnostic uses the same correction and is pinned to the rebuilt
installer. Successful PostgreSQL startup and the complete RU preparation must
still be confirmed on-host; local tests do not establish that outcome.
