# Business OS PR 289 RU rollout

Approved scope: deploy reviewed PR 289 while retaining the existing RU routes,
configuration, credentials, database and all unrelated backend code.

Evidence:
- PR head: 87de64132544aeb8e707b538f975ef8ac0e698ab.
- Merge main: 99ae7b989d6adbce10d00fe4ebebfc2ad136150c (same tree).
- CI 38617335176 succeeded; local build check, 36 push unit and 21 UI tests passed.
- Live build a46540428ef13967c60a; 60 HTTPS files matched the prior release.
- RU candidate build 05f9f54b55a82dd2eff6; only push module changes and mobile
  module addition; other bundled modules and eager bundle unchanged.
- User's server checksum confirms push source before:
  6bd9d08bf8615854f5e5ce8c475869f9e6bb11f5b9c3fa2adcaa1cad33cb7113.
- Reviewed push source after:
  974b7078e0448ed830ec28f82392ef4f3304687e631112983fd6bd400c076869.

Implementation plan:
1. Reuse prior frontend atomic directory exchange installer and rollback tests.
2. Discover existing edge binds and fingerprint config without logging secrets.
3. Test backend drift refusal, partial activation rollback, preserved unrelated
   files/metadata, interrupted deployment recovery and coordinator failure paths.
4. Stage sources/bundles/main privately. Recompile baseline using the pinned
   running image; require byte equality with deployed bundle. Disconnect builder
   network and compile only the reviewed CORS change using cached dependencies.
5. Probe an isolated no-network candidate with dummy credentials: health,
   unauthenticated rejection, CORS. No data mutations or notification sends.
6. Journal target backups before atomic file replacement; restart existing edge,
   verify health and CORS. Publish complete frontend using prior atomic workflow.
   Roll back both components on failures, refuse unrelated drift.
7. Run meaningful local tests and independent code review; publish pinned GitHub
   package and source, give short download/check/apply/rollback commands.
8. Server execution needs user's console (no configured SSH access here). Verify
   actual HTTPS build/assets after user executes, then browser/phone manual gates.

Current state: application reviewed and merged, no production mutations by this
session. Installer implemented; 24 local package/filesystem/fault tests pass.
The 21 mobile/push UI tests also pass against the actual RU candidate build.
Independent review found four recovery defects; all fixed and re-reviewed.
Both backups now precede activation; partial preparation is recoverable; web
verification failure does not block backend restoration; retry archives prior
attempts; staging parent entries are fsynced. Main remains 99ae7b989d6a.
Actual browser route verified through preserved network adapter:
https://139.100.237.167/functions/v1/push-api. Current health returns 200, missing
session returns 401, OPTIONS returns 204; gateway CORS is '*'. The unrewritten
legacy /api/proxy URL is not a supported public server alias and is not used by
the running client. No gateway/config changes are required.
UI login/registration, SW transition, physical iPhone layout and push delivery
remain production verification gates.

Server preflight follow-up (2026-10-14): the first installer correctly stopped
before staging/mutations, but its layout assumption was wrong. User's Docker
mount output shows /bos-{src,bundles,main} bound to the same release's nested
edge/{sources,bundles,main}, not siblings of web. Added failing reproduction,
corrected the exact expected paths, and added negative path/symlink/overlay
tests. Payload/build ID and backend source patch remain unchanged. 29 tests.
