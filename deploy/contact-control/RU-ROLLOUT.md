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

Next, use the returned baseline to prepare an immutable RU-specific installer:

1. Verify required CI on the exact PR head and merge without bypassing gates.
2. Preserve current RU frontend modules, backend imports, routing and credentials.
3. Back up the database and exact files before a transactional migration.
4. Install with `enabled=false` and `reminders_enabled=false`; no backfill or
   automatic scheduler installation. Pilot people/hours have not been selected.
5. Verify running hashes and health/authentication behavior. On rollback, disable
   the flags and restore the exact frontend/API backups, retaining additive schema
   and customer data.

This directory does not yet contain a reviewed RU apply installer. Do not deploy
the separate Sites preview or replace the RU release with a generic Pages build.
