# Client API runtime

`api.cjs` exports `createPortal({db,config})`, with `.handle(Request)` and Node
`.handler(req,res)`. The application owns persistence; it does not call the
employee bootstrap for customer responses. Every customer object is checked
against an opaque database session; explicit response projections exclude payroll,
private employee fields and internal comments. New customer identities never enter
`auth.users`, `profiles` or `business_staff`.

The staging launcher uses real persistent PostgreSQL semantics through PGlite.
The production launcher uses `pg`, a pool of at most five connections, explicit
transactions and the existing `public.orders`. Its adapter and PostgreSQL role
configuration have **not been exercised against the Russian production server**.
Production runtime installation is not release-verified while the dependency
registry is unavailable; direct versions are pinned but a generated lockfile is
still required before a reproducible release.

## Production boundary

`server/start.cjs` is separate from staging, binds only loopback, never creates
synthetic schema and never applies migrations. It requires `NODE_ENV=production`,
HTTPS canonical customer origin, reviewed real operator/documents, a live gateway
configuration, a separate OTP pepper and the existing staff verification secret.
It refuses test delivery and draft legal documents. `production.env.example` is a
non-working template: its zero SMS budget intentionally prevents startup.

Apply the five additive migration files in timestamp order as a separately
approved release. The runtime requires schema version 5. Every stage migration is
tracked in `client_schema_version`; clients still have no direct PostgREST grants.
The database service identity must be a deliberately provisioned trusted identity
able to access `orders`, the selected employee identity fields, and `client_*`
tables. It must not be issued to browsers. RLS on new tables denies generic
`anon`/`authenticated`; the service's explicit checks remain essential if it bypasses
RLS. No existing employee RLS policy is widened.

Public customer assets are served at `/client/`; the API is `/client-api/`.
Employee-origin nginx forwards only `/client-api/staff/` to the same service.
`CLIENT_STAFF_ORIGINS` is an exact HTTPS allowlist; customer mutations still require
the customer origin, the host-only HttpOnly cookie and its CSRF token.
Set nginx `X-Real-IP $remote_addr` (overwrite incoming header). Only explicitly
trusted loopback peers can supply this IP. All other forwarded headers are ignored.
Nginx must enforce an 8 MiB request limit and bounded request/connection rates.
Private storage is outside every webroot and served only through authorized API
endpoints. Files are decoded and reencoded by sharp, dimensions bounded, metadata
stripped, random storage keys and owner/thread checks enforced. Default account
quota is 100 MiB and 100 uploads/day; individual input 5 MiB, 10 photos/order or
unsent general thread. The private database, OTP outbox and files must be backed up
with matching permissions. No upload paths or OTP codes enter public logs.

## SMS adapter contract

No SMS provider was connected or charged. The `gateway` adapter posts JSON
`{to,message}` to the configured HTTPS endpoint with bearer authentication,
8-second timeout, no redirects, and requires a JSON response
`{accepted:true,message_id:"provider-reference"}`. This is an adapter contract,
not a claim that any specific provider accepts this format. An integration shim
must translate the chosen provider's API and pass a real delivery test before
release. Gateway 2xx alone is not treated as accepted delivery.

The configured maximum unit SMS price and daily count must fit the explicit daily
budget in kopecks. The provider contract must guarantee that maximum price.
Persistent limits apply globally, per phone, per IP and to verification attempts.
Codes are randomly generated, HMAC-hashed with the separate pepper, expire after
five minutes, allow five attempts, and are consumed once. Resend cooldown is one
minute. Staging writes each OTP to a mode-0600 file in its private outbox, never to
HTTP or logs. Production cannot select that transport.

## Shared order lifecycle and finance

New portal orders have the native employee internal status `В работе`, matching
the current employee create endpoint. The customer projection shows them as
accepted/no master and never as already scheduled. This avoids the legacy
completion guard treating the first report submission as a new/restarted work
cycle and clearing its report files. Existing guards were not changed.

`order-work-items.js` validates the same snapshot structure used by staff.
`order-payroll.js` already defines direct-source rules (60/40); its formulas remain
unchanged. An order's preliminary quote is immutable. Each estimate version has
its own snapshot and acceptance timestamp. If existing staff functionality later
changes an accepted order amount/items, the API marks the estimate historical,
requires a new version, and publishes a generic price-change event. Old accepted
snapshots and completed financial records are not rewritten. A warranty request
creates only an appeal linked to the completed order, never another paid order.

Client/staff message retries and order submissions share database idempotency
records. Account locks use `FOR NO KEY UPDATE` so ordinary foreign-key `KEY SHARE`
checks do not create an account/order lock inversion. Actual multi-connection
PostgreSQL concurrency remains a release check in addition to PGlite tests.

## Legal versions and notifications

Document versions store title, full body, hash and registration time. Startup
rejects altered text under an existing version. Consent records store document,
version and server time; personal-data consent is separate from terms and optional
marketing. Staff responses to personal-data requests become visible general
company messages. No automatic data deletion is implied by accepting a request.

In-app events, unread counts and persisted message history work without push.
`notifications.cjs` implements leased retries/idempotent transport delivery;
staging transport is private. Real customer push and provider delivery are not
connected or verified. Notification failure does not undo the saved order.
