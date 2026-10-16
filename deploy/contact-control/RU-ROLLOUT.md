# PR295: existing Russian server

Deployment is authorized by the user on 2026-10-16. Direct SSH from the working
environment returns `Network is unreachable`, so the host console is required.

PR295 merged as `3fb9bd0acc7cc954c53f52638127774e352e5a66` after CI run
38779022875 attempt 2 passed: 834 UI tests, 6 explicit skips, server/SQL/TypeScript
checks green. The prior failed attempt was retained; no tests were changed to
obtain this rerun result.

The first host check on 2026-10-16 confirmed RU build `2f2dbcab6f4f8b4881cb`
and complete frontend manifest integrity. Four contact modules matched directly;
the fifth matched the retained RU source exactly after substituting the existing
Netlify gateway origin with the RU origin. Version 2 recognizes this reviewed
substitution. The first script stopped at the API file read, before DB collection;
v2 collects DB metadata independently and distinguishes missing, symlinked and
oversized files. No production mutation has been performed.

`ru-preflight.py` is a self-contained Python 3 script for that console. It only
inspects the active Docker release, reads public application source hashes and
queries schema metadata in explicit read-only PostgreSQL transactions. It has
no apply mode and never invokes the scheduler or an application RPC. It does not
print environment values, DB connection URLs, credentials, application records,
staff identities or cron commands. It does not make network requests.

The script discovers the exact database used by the active release's PostgREST
container, including Docker network membership. A missing or ambiguous target
stops the check. An absent contact migration is expected on the first run.
`baseline` means code matches the pinned pre-PR295 source; `different` requires
review and must never be treated as permission to overwrite a local fix.
`BOS_CONTACT_PREFLIGHT_DONE` means collection finished, not that deployment ran.

Run the script as the existing Docker host administrator:

```sh
python3 ru-preflight.py
```

Offline verification:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 deploy/contact-control/test_ru_preflight.py
```

The second host check confirmed PostgreSQL 17.11, all required tables/columns,
all six baseline function hashes, `contact_config` absent, push runtime enabled,
and one active control tick. The exported API source has the observed nested path
`edge/sources/master-workflow-api/supabase/functions/master-workflow-api/index.ts`.
Version 3 recognizes it. The existing function answers its public health request
at `/functions/v1/master-workflow-api`; legacy proxy URLs are rewritten by the
existing RU frontend adapter, which the package preserves.

The first installer check stopped before any production mutation because its
payroll dependency pin incorrectly used current main. A read-only checksum from
the active edge container confirmed the retained export is exactly
`order-payroll.js` from `a47464c3002e75eac4988446b0de9dd6ed60e63b`, SHA-256
`271ad428d0a8367f77601708675893309b7bf8a685b24c1e4f44bb46b1b0ac89`.
The installer now pins that observed source. The workflow API only calls its
`masterView` function, which is identical in the retained and current-main files.
The existing payroll file is copied into staging, used for both bundle builds,
and never replaced in production. `fixtures/order-payroll.ru.js` is the exact
historical file for offline tests; it is not included in the deployment payload.

`bos295.pyz` is the RU-specific installer, pinned to main commit
`3fb9bd0acc7cc954c53f52638127774e352e5a66`. Expected build transition:
`2f2dbcab6f4f8b4881cb` → `77899953454eb1870e2e`.

```sh
python3 /root/bos295.pyz --check
python3 /root/bos295.pyz --apply
```

Its guarded sequence is:

1. Verify the exact current frontend, source, payroll dependency, schema and
   container configurations. Refuse unknown changes.
2. Stage API source/bundle privately. Rebuild the original bundle with the running
   image and require byte-for-byte equality. Compile the new source using the same
   dependencies after disconnecting the builder network. Run the staged gateway
   with dummy credentials, no external network, and health/auth/CORS probes.
3. Back up the complete frontend/API and create a private custom-format full
   PostgreSQL dump. Check the dump with `pg_restore --list` and retain its hash.
4. Apply the migration in one transaction with lock/statement timeouts, a second
   baseline check and flags-off assertions. Notify the existing PostgREST schema
   cache. Install with `enabled=false` and `reminders_enabled=false`; no backfill or
   automatic scheduler installation. Pilot people/hours have not been selected.
5. Replace only the workflow source/bundle; restart the existing edge. Atomically
   exchange the frontend directory and restart the existing Caddy. Verify hashes,
   public health/authentication and disabled flags. Existing container environment,
   routes, other handlers, payroll source, auth and scheduler remain intact.

Rollback is `python3 /root/bos295.pyz --rollback`. After drift guards, it disables
the contact flags before restoring the exact frontend/API backups. It retains
the additive schema and customer data; it never restores a whole DB over newer
orders or drops contact history. A retry archives earlier preparation/backup
directories instead of deleting them. Interrupted activation requires rollback.

Local release checks: 36 filesystem/failure/recovery integration tests (Docker,
network and DB lifecycle are explicit fakes), 8 diagnostic tests, and 4 disposable
PGlite PostgreSQL transaction cases (flags off, baseline drift, wrong flag rollback,
DDL failure rollback). The feature's original native PostgreSQL/server/UI CI is
listed above. Actual Edge compilation is a host-side gate before any migration or
activation; it has not run in this environment, which has no Docker daemon.

Rebuild with `python3 deploy/contact-control/build_package.py <verified-RU-input>`.
The input is the six public current assets listed in `build_package.py`; its exact
manifest SHA is pinned. The package does not download source at execution time.

Do not deploy the separate Sites preview or replace the RU release with a generic
Pages build. Production installation is complete only after the host prints
`RELEASE_OK BUILD_ID=77899953454eb1870e2e` and public verification agrees.
