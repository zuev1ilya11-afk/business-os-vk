# Business OS audit — 2026-10-08

## Scope and outcome

User authorized diagnosis, fixes, verification and deployment, prioritizing missing incoming Hands orders. This is a partial, evidence-backed audit; RU production recovery is blocked by missing authenticated access to its database, runtime and backups. No production data, reports, finances, credentials, flags or external messages were changed during this audit.

## Observed deployment map

| Component | Observed state | Evidence / limitation |
|---|---|---|
| GitHub main | `8a1fb97057286a77dc4903297a280eb5d8923e5b` | Fresh GitHub API and clean clone; old-entry redirect merged in #277 |
| Old entry | main build `1a2d9d1ea372f70dd54c` routes to RU | Repository/build check; installed phone migration not tested here |
| RU public frontend | `https://139.100.237.167`, build `d1bd2bcf02ef88e9cb6c` | Trusted HTTPS GET, index and public build manifest; some probe connections timed out |
| RU API | `/functions/v1/hands-api` returns 405 for GET | Confirms route only, not authenticated import or DB destination |
| RU transport | same-origin rewritten API/Storage/Auth/REST calls | Inspected migration `release_network.js`; live target runtime/DB unverified |
| RU backend source | migration inventory: hands-api v11, lifecycle v18, mini-app v28 | Historical migration inventory, not fresh target source export |
| Old Supabase | database default read-only on; four cron jobs inactive | Fresh read-only SQL against the source project |
| Incoming Hands | source still accepted a CREATED webhook after cutover | Matching new source order and webhook receipt at 2026-10-08T10:45:44Z |
| Outbound workers | reminders, push recovery, Hands report worker, control reminders | These four source cron jobs are **not incoming Hands polling**; source jobs inactive |
| Target cron, storage, backup | not independently confirmed | Requires RU server access; historical success marker is insufficient |

## Incident and defects

### P0 — source continues to receive incoming Hands events

The source contained 116 orders at inspection, compared with the historical transfer marker of 115. One order and its matching webhook receipt were created after the cutover window at 10:45:44Z (13:45 Moscow). The external ID was reported privately to the owner and is excluded from this public report. This establishes post-cutover intake into the source. It does **not** establish absence of that ID from RU: target comparison is blocked.

The source database setting `default_transaction_read_only=on` was confirmed, along with no role-specific read-write default override. Nevertheless the application write occurred. Treat the source-freeze assumption as disproven, not as a verified write fence. No speculative cause, revoke, trigger, function replacement or source shutdown was applied.

The [PostgREST 14 transaction contract](https://docs.postgrest.org/en/v14/references/transactions.html) explicitly selects READ WRITE for POST/PATCH/PUT/DELETE. PostgreSQL describes `default_transaction_read_only` as a [transaction default](https://www.postgresql.org/docs/17/runtime-config-client.html), not an access revocation. Together with the observed post-cutover write, this explains why that setting alone is insufficient as an application write fence. The specific request's SQL transaction was not traced. Source indexes were confirmed: unique `(external_source, external_id)` for non-null IDs and unique webhook `delivery_id`; their presence on RU remains unverified.

Required controlled recovery:
1. Obtain the active RU release directory, backup/restore proof, current handler exports, target orders and delivery IDs for the cutover window.
2. Read the configured Hands webhook destination through its authorized administration mechanism. The observed old-source receipt is evidence of routing, not an export of provider settings.
3. Build a dry-run comparison keyed by source/account/external ID. Include source rows created **or updated** after freeze and compare them with upstream and RU. Do not simply insert every source row.
4. Correct the configured destination or reviewed routing, retaining webhook authentication and retry semantics. Avoid a second independent importer. Verify sink acknowledgements correspond to saved events/orders.
5. Restore confirmed missing orders through the existing target importer. Preserve assignments, manual edits, workflow, reports and financial snapshots. Check concurrency/unique constraints, notification side effects and repeat idempotency before applying.
6. Confirm a new live event on RU, then verify no continued source writes. Never thaw or return clients to the stale source.

### P1 — page-size mismatch truncates import

Both tracked import endpoints and the exported source v11 sync routine stopped when `rows.length < requested per_page`, discarding provider pagination metadata. The observed provider envelope is `orders,page,per_page,pages,total` (existing HANDS-ORDER-DETAILS.md). Synthetic reproduction requests 500 but receives one row per page across two advertised pages: the old code saves one order and reports success.

Patch: use advertised pages/effective page size, validate malformed envelopes and repeated page numbers, retain existing filters and limits. Reaching the page bound with unread pages reports `HANDS_SYNC_INCOMPLETE`; it does not silently claim full reconciliation. Larger backfills still require bounded date windows and verified target recovery.

### P1 — a bad record strands the rest of a batch

Old loop aborts on the first import exception, so later valid records are not attempted. Missing IDs are silently ignored. Patch processes remaining rows and reports `HANDS_IMPORT_PARTIAL`, safe counts and error categories. It does not emit upstream customer/error payloads in this aggregate. A later retry still uses the unchanged importer, unique key and optimistic concurrency behavior.

### P1 — malformed successful response looks empty

Old parser turns an unexpected object into an empty list and reports success. Patch explicitly rejects an unrecognized envelope with `HANDS_RESPONSE_INVALID`.

## Safe release boundary

`hands-api` v11 contains private webhook configuration absent from the tracked older handler. **Do not deploy the tracked full hands-api over production.** `scripts/patch-live-hands-sync.cjs` accepts only a fresh reviewed private v11 export, verifies the exact sync fixture, changes that routine and adds a private helper file. Every surrounding webhook, authentication, import, report and assignment byte is retained. The tool writes a new mode-0600 file and never deploys it. If the target export differs, stop and review its actual source.

The lifecycle endpoint uses the same traversal helper; its target source must also be compared before deployment. No migration or frontend rebuild is needed for these backend changes. The patch does not switch webhook URLs, freeze the source, restore data, or prove live recovery.

Rollback: back up target source/config before any release; restore only the previous target handlers and their dependency files. Preserve the active RU DB/storage and all new data. Never redirect back to the old source as a rollback.

## Verification matrix

Local tests use existing real handlers with synthetic DB/provider boundaries. They do not establish production network, database permissions, device/operator connectivity or external delivery.

| Function / role | Scenario and expected result | Evidence / version | Status and remaining blocker |
|---|---|---|---|
| Hands / operations | Multi-page import, repeats, malformed source, failed row, bounded partial run | New failing reproductions, then passing server tests | Fixed locally; target deploy and reconciliation blocked |
| Hands / private handler | Preserve webhook/auth/private configuration, ACTIVE-only behavior | Exact v11 sync fixture and patch behavior tests | Locally verified; fresh target export required |
| Auth / all roles | Sessions, role denial, refresh and stale launch checks | Existing server + browser suites | Local verification only; target test accounts unavailable |
| Orders / operations | Create/edit/assign, report-review boundaries and accepted receipt preservation | Existing server + browser suites | Local verification; target write tests not run |
| Master workflow | Contact, agreement, schedule, start, submit, progress | Existing server + browser suites | Local verification; real order 1696 was not modified |
| Reports / masters and managers | Attachment links, finalization, timeout/replay, review/reject | Existing server + browser suites | Local verification; actual target Storage/DB round trip unverified |
| Dispatch | Date filters, unassigned list, duration/reschedule and conflicts | Existing browser suite | Local verification; target data/timezone comparison pending |
| Management | Role switches, contact history, manual completion guards | Existing server + browser suites | Local verification; no real completion performed |
| Finance | Payroll contracts, periods, expenses, source-specific amounts | Existing server + browser suites | Local verification; no formula or historical payroll changes |
| Staff/catalog | Role gates and work/price contracts | Existing suites | Local verification; target grants/schema inventory pending |
| Avito | Dialogs, linked orders, retries and assistant boundaries | Existing server + browser suites | Mocked provider only; live settings, destination and 08:00–22:00 window pending |
| Push | Sender/session/queue contracts | Existing tests | Real delivery, target VAPID/runtime and phone permission unverified |
| PWA/refresh | Build consistency, update flow, background refresh | Build check + existing browser suite | Chromium fixtures; installed iPhone/Android and 4G/5G not verified |
| Backups/runtime | Auto-start, disk, restored DB, offsite backup | Historical release tools reviewed | Target inspection/isolated restore blocked |

## Dependency inventory

| Dependency | Consumers | Evidence | Remaining check |
|---|---|---|---|
| Node/npm + package lock | Build and regression suite | Reproducible `npm ci --ignore-scripts`; @playwright/test 1.55.1 pinned | No blanket upgrades |
| Browser binaries | UI tests | Chromium suite executed | Safari/Android device tests |
| Supabase JS/Deno | Edge handlers | Existing version conventions retained | CI TypeScript checks and target bundle validation |
| PostgreSQL/constraints/RLS | Import, workflow, finance | Existing isolated test contracts | Fresh target schema, unique indexes, rights and disposable SQL tests |
| Caddy/TLS/origin routing | Public frontend and API | Trusted HTTPS and migration config inspected | Server config drift, renewal, actual routing/runtime env |
| Cron/pg_net/Vault | Outbound workers and reminders | Source schedule inventory | Target jobs, queue progress, decrypted key equality without disclosure |
| Storage | Existing/new attachments | Historical migration evidence only | Target read/write, signed links and backup inventory |
| Hands provider | Incoming webhook and manual sync | Source receipt; live source handler read | Provider destination, API account, source-to-target dry-run and live event |

## Verification ledger

- Initial `npm run build:check`: pass, main build `1a2d9d1ea372f70dd54c`.
- Initial server baseline: 696 passed, zero failures.
- Import reproductions: all 10 initially failed on the expected defects.
- Focused import/details/review tests after repair: 57 passed.
- Sync + private patch tests: 12 passed.
- Server suite after initial patch: 708 passed; after independent-review fixes: 712 passed, zero failures.
- First complete browser run: 588 passed, 1 pre-existing skip. It overlapped edits. A second broad run returned no captured completion marker, so it is not counted as a completed final gate. Targeted Hands/lifecycle browser checks cover the reviewed revision separately; full exact-revision CI remains pending publication.
- Local Docker and disposable PostgreSQL are unavailable. Installing the workflow-pinned Deno through `npx deno@2.9.7` failed with npm ETARGET; no substitute runtime or dependency change was made. The required CI gates have not run for this branch. No target runtime or deployment claim.

Independent review found a total-only pagination fallback and contradictory terminal metadata case. Four regressions failed first, then the received-row counter fixed both endpoints. Total traversal now counts source rows independently of successful imports. The review's minor suggestion for a separate export-configuration guard test is deferred; source-byte preservation and wrong/repeated routine rejection are tested. The existing skipped browser case is `gas-archive-health.spec.js` (live Google Apps Script archive reachability).

`npm audit --json` including development dependencies reported zero advisories for the installed npm lockfile. This does not cover Deno, container images, OS packages or every external CDN dependency.

Remaining audit areas are explicitly blocked above; this report does not claim every function works in production.

## Publication history and production boundary

Automatic approval review rejected the feature-branch push twice. Read-only follow-up confirmed the connected GitHub owner, admin/push permission, exact repository URL, and absence of the private webhook token/customer incident ID in the diff. Review still requires explicit user-authored approval to publish code. The push was not bypassed through another tool. At the end of that initial pass, no PR, CI run or deployment had been created. Local commits and a downloadable patch were retained.

Follow-up: the user explicitly authorized publication of this branch and creation of a PR on 2026-10-08. That authorization removes the publication blocker; the associated PR is authoritative for current CI status. RU runtime access and production reconciliation remain blocked.

Final targeted browser verification on reviewed code: `hands-manual-submit`, `hands-report-delivery`, `hands-unassigned-filter-v163`, `order-lifecycle-v106`: 24 passed, zero failures.

## RU console follow-up — 2026-10-08

The owner can execute scoped scripts through the RU server console; direct SSH from the agent remains unavailable. This supersedes earlier statements that no fresh target inspection was possible.

- Active release: `bos-release-to2wblxf`. A separate legacy database also exists, so database selection must use the actual REST connection and shared Docker network.
- Read-only target inspection confirmed 116 orders, 107 from Hands, uniqueness on `(external_source, external_id)`, 147 webhook receipts and 4 active cron jobs at that checkpoint. Active cron count does not establish successful job execution.
- The privately identified post-cutover source order was absent from RU. The last target receipt at inspection was `2026-10-08T09:11:07.689461Z`; a complete cutover-window reconciliation is still required.
- Target private Hands sync matched the reviewed v11 fixture. Private source/bundle backups were created on the server and a patched bundle was built successfully. No production source/bundle was replaced.
- Isolated candidate API exited with status 1, without an OOM indication. Diagnostics exposed five absent candidate gateway settings: BOS Auth/REST/Storage origins, JWT secret and VK app secret. Complete dummy settings have been added; successful boot and the full exit cause are not yet confirmed.
- The preparation script now reports live routing metadata and the REST database container match in one run. These are metadata checks, not service connectivity, database health or logical database identity proof.
- Fresh public checks returned 200 for `/` and 405 for GET `/functions/v1/hands-api`. `/__bos_ready` is not exposed publicly (404) and is not an activation gate.
- Initial published patch and read-only diagnostic commits passed CI. Run `37780918442` on commit `a6a1eb51b1bd1f5dc50568c67b19e76905f2b886` subsequently failed only at the full browser step: 587 passed, 1 skipped, and `gas-bridge-health` timed out at 30 seconds on both attempts against the old Supabase origin. Build, TypeScript, frozen dependencies, SQL and server checks passed. The bridge's current RU configuration and test target need review; the failure is not bypassed or declared fixed. Ten preparation tests passed locally and the changes were independently reviewed.

No webhook destination switch, recovery insert, activation or production restart was performed by the preparation scripts. The consolidated next steps and remaining application checks are in [the RU recovery runbook](superpowers/plans/2026-10-08-ru-hands-recovery-runbook.md).

Later checkpoint: preparation from `885dbdf2b3199e61d76147e2c1f22facda18b604` reported no absent live gateway settings, all three service host/network metadata matches, and the expected REST database container. The isolated candidate still exited 1 after its dummy settings were completed; missing settings were an incomplete test configuration, not a demonstrated complete explanation of the exit. Saved-log diagnosis is the next step. CI run `37782750947` for that exact commit completed successfully, so the previous GAS timeout did not recur in this run; the old test origin still warrants migration review.

Saved-log follow-up: the gateway reports `invalid private upstream`. Candidate BOS origins had been replaced with loopback placeholders. Preparation now reuses only the active release's matched, credential-free service origins, retaining dummy secrets and Docker `--network none`. Gateway source/validation is unchanged; no service or DB access is enabled. Sixteen preparation tests pass, including origin validation and secret-preservation boundaries. Successful server boot remains to be confirmed.
