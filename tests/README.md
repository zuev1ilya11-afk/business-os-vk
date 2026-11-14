> **Audit note — 2026-11-11:** The VK-auth instructions below describe a historical
> `profiles`/Supabase-auth implementation. This branch has no `app-vk.js` or
> `tests/vk-auth.test.mjs`, and the active frontend calls `vk-session-api`, whose
> deployed source is not tracked here. Do not use the historical deployment
> command as a restoration step for the current RU backend.

Current isolated authentication checks (Node 24):

```sh
node --test tests/launch-fallback-freshness.test.cjs
```

```sh
node --test tests/server-audit.test.cjs
```

These execute repository handlers with synthetic data. They do not establish
production parity, current RLS/bucket settings, or a successful real VK login.

---

# VK auth regression checks

Run from the repository root with Node.js 24 or newer:

```sh
node --test tests/vk-auth.test.mjs
```

The tests execute the actual Edge Function after stripping TypeScript types.
Only the Supabase import and Deno environment/server are stubbed. No real
credentials, network calls, or database writes are used. Frontend transport is
checked against the actual `app-vk.js` in a minimal browser context.

Canonical strings in the encoding vectors are explicit, and signatures use
Node's HMAC implementation independently of the Edge Function's Web Crypto.
These checks do not replace a real VK launch after deployment.

Algorithm reference: [VK's official Node example](https://github.com/VKCOM/vk-apps-launch-params/blob/master/examples/node.js).

## Deploying the fix

After merging the fix and updating your local checkout, redeploy `vk-auth` to
the existing Supabase project:

```sh
supabase functions deploy vk-auth --project-ref obsropbslfwtanyspjbi --no-verify-jwt
```

The function authenticates with VK launch signatures before creating a Supabase
session, so it must be reachable without an existing Supabase JWT. Keep the
existing `VK_APP_SECRET` in Supabase Edge Function Secrets; do not put it in
source code or frontend configuration.

Alternatively, replace `vk-auth/index.ts` in the Supabase dashboard editor and
deploy it there, preserving the existing JWT setting. No frontend deployment is
needed for this change. Reopen VK Mini App 54758847 and use “Обновить вход через
VK” if a cached Supabase session would otherwise skip the new authentication.

# Read-only production collector

Run `python3 tests/audit-production-readonly.test.py` for the metadata-only
collector's unit regressions. One failed container inspection must preserve
the other containers' BUILD/manifest results without disclosing stderr or
host paths. `complete` describes evidence collection, not application health:
an inspected `unhealthy` container is still complete evidence. Unavailable
artifact checks and the container limit make collection incomplete.
A readable file with a known hash mismatch is complete evidence; an unreadable
asset or index preserves its sanitized failure and makes collection incomplete.

Run `python3 tests/audit-docker-template.test.py` for real Docker CLI formatting
against a temporary synthetic Unix-socket Engine API. No real Docker daemon,
container, external network, or privileged operation is used. The fixture
reproduces the old `.Id` raw-map fallback failure and checks absent/null,
healthy and unhealthy Health values using the collector's actual template.
Without Docker CLI these integration tests explicitly skip; the CI safety step
requires the installed CLI before executing them.

# Read-only release journal verification

`python3 tests/audit-release-journals.test.py` uses synthetic files only. The
standalone `scripts/audit-release-journals.py` reads the observed report and
Lemana journal pointers and live release tree. It checks applied BUILD continuity,
intersecting before/after hashes, every effective target (newer price targets
supersede report targets), and the full edge/main filename/hash set against the
latest journal's before.main. It never imports an installer, invokes Docker or
another process, accesses the database/network, or writes files.

The output has at most 15 lines and five allowlisted mismatch paths; unavailable
reads, malformed evidence and budgets make COMPLETE=false. A fully read hash
mismatch is complete evidence but VERIFIED=false. Exit zero requires VERIFIED.
Only file hashes are compared: journal provenance, Docker image/env fingerprint,
uid/gid/mode, database state and backup restoration remain outside this check.
Fixtures can override --live, --report and --price; defaults are the server paths
observed on 14.11.2026. These defaults do not establish that future mounts match.
