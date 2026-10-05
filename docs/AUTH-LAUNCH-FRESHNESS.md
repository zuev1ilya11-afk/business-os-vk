# VK launch fallback freshness

Audit baseline: `1199a06493b36f7c652348682f01914ee743ba90`.
Read-only production comparison: 2026-10-05. No production configuration or
credentials were saved, and no live authentication or business action was sent.

## Finding and scope

The normal production `vk-session-api` v8 verifies signed launch parameters and
applies a 24-hour timestamp window before issuing a 12-hour BOS session. Four
secondary handlers also accepted signed launch parameters when no valid BOS
session was present, but omitted the timestamp check. This allowed previously
valid signed launch data to remain usable after the issuer's normal window.
The report handler could also issue a fresh BOS session through that fallback.
This requires possession of valid signed launch data; signatures and active
employee/role checks were still enforced. No production exploitation check was performed.

The following live entrypoints were byte-identical to the audited repository
sources immediately before this patch:

- `avito-api` v9: Avito status, inbox, messages and role-permitted operations
- `report-api` v23: legacy report upload/finalization and fallback session issuance
- `report-file-upload` v4: authenticated multipart report attachments
- `profile-self-api` v6: presence, own-profile editing and legacy workflow bridge

All four used `verify_jwt=false` and custom authentication. The source comparison
used the read-only function-export API without printing or saving private source
configuration. This is a dated comparison, not a deployment result.

## Bounded correction

Each of those four fallback verifiers now requires a positive integer `vk_ts`
and preserves the issuer's existing symmetric 86,400-second window. Missing,
zero, non-numeric, non-finite and fractional timestamps are rejected. BOS session
authentication is checked first and remains independent of launch age.

The correction does not change the signature canonicalization, role permissions,
BOS token lifetime, report rules, payroll or stored records.

VK's current official SDK declares `vk_ts: number` as a required field of
`GetLaunchParamsResponse`; `VKWebAppGetLaunchParams` returns that response.
Sources checked on 2026-10-05:

- [VKCOM SDK response contract](https://github.com/VKCOM/vk-bridge/blob/master/packages/core/src/types/data.ts)
- [Raw SDK contract](https://raw.githubusercontent.com/VKCOM/vk-bridge/refs/heads/master/packages/core/src/types/data.ts)

The developer-portal launch documentation was not accessible during this audit.
Archived pre-timestamp examples were not treated as the current contract.

## Separate production issuer work

`vk-session-api` v8 remains production-only and has not been changed or added to
this repository. Its current check conditionally applies the age limit only
when the parsed timestamp is truthy. Missing/zero/non-numeric timestamps therefore
still require a separately reviewed issuer correction. Capture and compare its
current source in the authorized release process; never overwrite it from an
invented repository replacement. Preserve its existing VK access-token fallback,
registration and first-owner behavior unless separately reviewed.

Before deployment, obtain fresh drift evidence for every affected function,
review the issuer correction separately, deploy only the reviewed functions,
and verify actual VK entry plus existing desktop/password sessions. GitHub Pages
publication alone does not deploy these backend changes.

## Verification boundary

`tests/launch-fallback-freshness.test.cjs` executes actual repository handlers
with synthetic signed launch data, an isolated in-memory database and controlled
Storage behavior. It covers old/missing/zero/NaN/infinite/fractional/far-future
launches, valid timestamps inside the existing window, forged signatures,
existing BOS sessions, and lack of database/storage access on rejection.

Before the correction, 28 targeted checks failed and 20 controls passed. After
the correction, the focused auth/Avito/report run passed 215 tests. These results
do not claim real-account VK, Avito, Hands, Sheets, Storage or Google Drive E2E
verification. The aggregate suite must be rerun against the final combined patch.
