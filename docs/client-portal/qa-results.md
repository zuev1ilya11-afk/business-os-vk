# Client portal QA — 2026-11-05

## Evidence rules

This report separates local persistent PostgreSQL/PGlite checks, browser checks,
fixture-based regressions, and unverified external integrations. Synthetic staff
and client data must not be sent to production APIs. Tests fail on unexpected
external traffic. Local benchmark figures do not establish production capacity.

## Baseline before client-portal changes

- `npm run test:server`: **842 passed, 0 failed**, 34.3 seconds, Node 24.22.1.
- Existing server tests execute production edge-function code against test
  adapters and isolated PGlite where specified. They are not real Avito, Hands,
  Lemana, SMS, push, PostgreSQL service, or production-server tests.
- Local Playwright browser binaries are absent. Supported managed preview and
  cloud browser are available for manual browser QA; execution recorded below.

## Test plan

1. Client registration uses a random expiring private test OTP; draft order
   survives login. Client cannot self-assign staff role or read staff bootstrap.
2. Published catalog and server quote; custom request; positive quantities;
   immutable price/address snapshot and explicit estimate version acceptance.
3. Shared order visible to dispatcher; master assignment and confirmed visit;
   client sees only public card and allowed fields. Wishes remain preferences.
4. Bidirectional persistent messaging, general support, pagination and read state;
   retry idempotency and literal rendering of HTML payloads.
5. Private upload decoding/metadata removal, per-order quotas, foreign-attachment
   denial and authenticated download. No SVG or disguised HTML.
6. Reschedule/cancel/warranty requests; no duplicate order or payroll accrual.
7. A/B account isolation for all object IDs, CSRF, expired/reused OTP, rate limits,
   stale version conflicts, logout/all-device revocation and persistence restart.
8. Mobile 360/390 px and desktop; keyboard-sized viewport; no horizontal overflow;
   public pages without login; useful empty/error states; no cached personal API.
9. Bounded local synthetic load: dashboard/order list, create, message and upload;
   record concurrency, latency, errors and process memory/CPU.
10. Existing staff role/finance/report/integration-contract regression checks.

## Final automated results

| Check | Result | Evidence |
| --- | --- | --- |
| Existing server regressions, `npm run test:server` | 850 passed, 0 failed; 43.6 s | [log](qa/server-regression.txt) |
| Final targeted staff regression after chat-photo edits | 8 passed, 0 failed; 2.0 s | [log](qa/staff-regression.txt) |
| Client suite, `npm run test:client` | 45 passed, 0 failed; 30.9 s | [log](qa/client-regression.txt) |
| Integrated business journey, including all four staff role boundaries | 13 Node tests passed (12 scenarios plus wrapper); final focused repeat 6.3 s | [log](qa/integrated-e2e.txt) |
| Selected staff Playwright suite | 3 could not launch; no test assertions executed | [launch errors](qa/ui-unavailable.txt) |
| Isolated HTTP load | 155 workload requests, 0 errors, 5 concurrent clients | [JSON](qa/load-results.json) |

The integrated checks use the real portal API, persistent PGlite, existing
production staff Edge function modules, and actual order-guard migrations.
They do not intercept routes with canned responses. The native combined report
upload and split file-upload/finalize paths both finish the same shared order
through dispatcher approval. The external Google Drive delivery transport is
replaced explicitly with a private disk archive; file bytes and the two-file
manifest are checked. This does not verify Google Drive delivery.

The client suite covers separate client identities, owner/manager/dispatcher
access and master rejection at global endpoints, public DTO allowlisting,
immutable quote/address snapshots, server prices, exact estimate acceptance,
legacy price-change invalidation, stale versions, order/message retry
idempotency, cross-client denial, private image decoding and reencoding,
general/order chat attachment isolation, upload quotas and idempotency, trusted
IP limits, paid-repeat current pricing, read state, pending reschedule,
warranty without a new paid order, OTP expiration/exhaustion/replay/throttling,
CSRF, logout/revocation, document version integrity, production fail-closed
configuration, notification lease/retry/crash handling, and separate-directory
restore of the database, sessions, messages and private file bytes.

The current staged schema is client version 5, applying these actual files:

- `20261105150000_client_portal.sql`
- `20261105153000_client_documents.sql`
- `20261105154000_client_notification_leases.sql`
- `20261105155000_client_price_events.sql`
- `20261105160000_client_message_attachments.sql`

[Source hashes](qa/source-hashes.json) identify the inspected portal and migration
files. Later edits require targeted checks; these results do not cover an
unseen future bundle.

## Browser evidence

The managed local preview served the real persistent staging API. Browser checks
used the cloud Chrome UI and no API route mocks. The verified desktop viewport
was 1363 × 936 CSS pixels (1348 px content plus scrollbar). Narrow checks used
an explicitly labelled 390 × 844 iframe; content width and scroll width were
both 375 px because of its 15 px scrollbar. This is responsive-layout evidence,
not physical-device or touch/keyboard emulation.

Passed in the browser:

- Public services load without authentication; unconfirmed prices say “После
  уточнения”, and staging prominently asks for fictitious data.
- Select a service, enter quantity 2, synthetic name/address/access details,
  desired time, length/wall/dismantling options, and calculate a real API quote.
- Quantity 0 is blocked by the form's minimum; valid data reaches the review.
- Review renders the injected `<img … onerror=…>` payload as literal text,
  includes work parameters, and distinguishes a wished time from a confirmed
  visit. No script dialog was triggered.
- Opening and dismissing the phone-verification prompt then reloading retains
  the draft service, quantity, address, description, parameters and time.
- Catalog, form and review fit the narrow viewport with no document horizontal
  overflow; bottom navigation and primary actions remain visible/reachable.

Screenshots contain only synthetic draft data:

- [Desktop catalog](screenshots/client-portal-services.jpg)
- [Desktop quote review](screenshots/client-portal-review.jpg)
- [390 px catalog](screenshots/client-portal-mobile-catalog.jpg)
- [390 px request form](screenshots/client-portal-mobile-form.jpg)
- [390 px quote review, XSS evidence](screenshots/client-portal-mobile-review.jpg)
- [390 px clean request form](screenshots/client-portal-mobile-form-clean.jpg)
- [390 px clean quote review](screenshots/client-portal-mobile-review-clean.jpg)

Authenticated browser journeys remain **unverified**. The browser's secure
authentication interface requires human credential entry and does not permit
automated OTP/password handling. No public bypass or injected session was used.
The complete authenticated business journey was checked through the real API.
The repository's selected staff UI suite could not launch because Chromium
headless-shell build 1193 is absent. No passing claim is made for those three
tests or the full existing browser suite. Newly added staff chat-photo UI also
needs authenticated browser validation.

## Bounded load

Reproduce with `node client-portal/tests/load-isolated.cjs`. It creates a fresh
private temporary database and loopback HTTP listener, refuses a production or
non-test delivery target, registers five synthetic clients through private
random OTP delivery, performs six rounds per client, verifies persisted counts,
revokes sessions, and deletes only its own disposable directory.

Latest frozen-source run: 1.995 s; 155 measured requests, 0 errors. Authentication/setup/logout
requests are additional and not included in the latency table. Persisted counts
are exactly 5 clients, 30 orders, 30 messages and 5 private attachments.

| Route category | Requests | p50 ms | p95 ms | Maximum ms |
| --- | ---: | ---: | ---: | ---: |
| Session/dashboard | 30 | 48.9 | 102.8 | 159.6 |
| Create order | 30 | 64.5 | 154.4 | 170.6 |
| Order list | 30 | 65.9 | 96.1 | 105.3 |
| Send message | 30 | 59.9 | 114.4 | 147.5 |
| Read messages | 30 | 52.9 | 88.1 | 92.2 |
| Decode/reencode photo | 5 | 82.7 | 120.7 | 120.7 |

Sampled peak process RSS was 704.1 MiB, including the in-process PGlite runtime.
Workload CPU was 2538.1 ms user plus 27.6 ms system. These are local synthetic
measurements, with 2 × 2 pixel upload fixtures and no external network. They
do not establish production concurrency, PostgreSQL-service capacity, large-file
upload capacity, memory sizing, or a sustained-load service objective.

## Defects found and resolved during QA

- Public startup failed on local HTTP without `crypto.randomUUID`; the frontend
  now uses a cryptographically strong fallback and the public journey passes.
- A client-created internal “Новая” status triggered an existing report-cycle
  reset when the native report API wrote “В работе”, removing its new receipt.
  Creation now follows the native internal workflow while the client DTO still
  clearly reports no master and no confirmed visit. Both native report paths
  pass with the existing guard unchanged.
- Attachment display names retained traversal fragments; the server sanitizes
  them and the private-file boundary checks pass.
- The initial test PNG was invalid for strict decoding. It was replaced with
  a valid generated fixture; server decoding was retained.

No production-readiness claim follows from these checks. Production installation
with real PostgreSQL/dependencies, HTTPS, private storage, actual legal/operator
details, delivery providers and authenticated UI checks remains a release gate.

## External checks not performed

- Production infrastructure resources, live schema and deployed bundle parity.
- Real SMS or push delivery; real Avito/Hands/Lemana external integration calls.
- Physical Android/iPhone device behavior or actual iOS installation.
- Production backup restore and production load capacity.
