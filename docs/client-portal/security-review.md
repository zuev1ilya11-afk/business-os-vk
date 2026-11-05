# Independent security review — client portal

Date: 2026-11-05. Scope: repository source and isolated test data. No production
credentials, records, services, notifications, or migrations were accessed.

## Existing staff boundary

The staff API accepts an HMAC-signed `x-bos-session` identifying an active row in
`business_staff`. A client cookie must be a different opaque token namespace,
must not reuse this key, and must never be exchanged for a staff token.
Clients must not enter `business_staff` or the legacy `auth.users` onboarding
path. The historical `supabase/setup.sql` includes an `auth.users` trigger that
creates staff-oriented profiles and destructive reset SQL; it was read, not run.
Actual production trigger state is not verified.

Two existing broad-read paths were found: `mini-app-api` and `claims-api`
restricted bootstrap records only when `role === 'master'`. An active staff row
with an unknown role therefore inherited an unrestricted read. Both endpoints
now reject roles outside `owner`, `manager`, `dispatcher`, and `master` before
handling authenticated requests. No payroll formulas or recognized role
permissions changed.

Behavioral evidence: `tests/client-portal-staff-boundary.test.cjs` checks unknown
roles, opaque client tokens at both old APIs, and unchanged recognized-role
bootstrap visibility. Together with `tests/server-audit.test.cjs`: 25 passed,
0 failed. These run actual edge-handler code against the repository's test DB
adapter; they are not live authentication checks against production.

## Review criteria for the added service

The independent final pass must inspect and exercise:

- Request-derived client identity only from session, ownership on every
  address/order/message/file/request read or write, and explicit response fields.
- Persisted atomic rate limits, random expiring one-time OTP, capped retries,
  private test delivery, generic account-existence responses, and SMS budget.
- Host-only HttpOnly cookie, Secure outside loopback staging, expiry/revocation,
  origin and CSRF validation, and no API/PII service-worker caching.
- Immutable request/address/price snapshots, idempotency payload matching,
  catalog price authority, nonnegative quantities, and optimistic concurrency.
- Real image decode/re-encode, bounded dimensions/input/output/count, no public
  filesystem route, authenticated download, and no user-controlled storage path.
- Public master projection, no internal remarks/payroll leak, no automatic
  phone-history claim, and verified linking of a specific legacy order.
- Warranty/support requests do not insert a payable order or change accruals.
- Production refuses test auth, incomplete legal documents, and staging schema.

The separate service's use of an administrative database connection means
RLS alone is not evidence of client isolation. HTTP ownership tests are required.

## Final added-service review

The independent HTTP-handler checks use a disposable persistent PGlite database
with the actual portal migration, the repository's prior guard migrations, and
real image decoding with Sharp. They do not substitute a fixture DB for the
portal service. `client-portal/tests/security.test.cjs` covers OTP privacy,
expiry/replay, retained failed attempts/resend limits, cookie scope, origin/CSRF,
privilege and price injection, unknown/inactive staff, all-device logout, recent
reauthentication for phone changes, generic DB role denial, production document
and SMS-budget gates, image re-encoding/EXIF removal, and foreign-file denial.
Final independent command: `node --test client-portal/tests/security.test.cjs` —
**19 passed, 0 failed**, 8.7 seconds. This also verifies immutable document text,
legacy source/finance preservation on linking, private general-chat attachments,
privacy-response ownership, current-catalog paid repeats with retained work
constraints, storage quotas, upload idempotency, and persisted IP limits.

Findings corrected during review:

1. The two pre-existing staff bootstrap endpoints now deny unknown roles.
2. The production document gate requires the complete document set and actual
   nonempty reviewed text; optional metadata cannot stand in for the policy,
   service terms, usage terms, or separate personal-data consent.
3. OTP failures commit rate-limit/attempt increments while business errors
   roll back their mutations. One-time codes never appear in HTTP responses.
4. Uploads are decoded, bounded and re-encoded to WebP, removing source metadata;
   both account and order ownership protect downloads. This was tested on bytes,
   not merely file extensions.
5. Frontend pending responses now use an authentication generation and abort
   on logout, preventing an old account's saved-address response from rendering
   in a later account's form. Failed uploads are scoped to their original order.
6. Reverse-proxy client IP is accepted only from explicitly configured trusted
   peer addresses and only when it is a single valid IP. Arbitrary forwarding
   headers otherwise cannot bypass per-IP limits. Real nginx configuration still
   requires verification at release.
7. Later legacy staff edits to amount or work composition invalidate the
   effective current estimate. The prior accepted version and timestamp remain
   stored; the client must receive and accept a new version. Reusing the old
   acceptance is rejected. A public price-change event is recorded.
8. General-message photos remain bound to their owner and exact thread, and a
   file cannot be reassigned to a second message. File retries with the same
   request identifier return the same file. Total owner storage and daily
   upload limits prevent the sent-message path from bypassing quota controls.
9. Account/order locks use `FOR NO KEY UPDATE` for non-key changes, allowing
   foreign-key key-share locks. Actual multi-connection PostgreSQL concurrency
   still requires production-adapter rehearsal; PGlite serializes transactions.

The notification worker was independently read after its tests passed. It uses
bounded leased claims, guarded acknowledgement, retry backoff, a stable delivery
identity, redacted error codes, and no order/finance mutations. Its real-provider
idempotency promise remains an integration contract until a provider is connected
and tested; the current local transport is explicitly synthetic.

Production findings that cannot be closed by local tests: the actual schema,
registration triggers, RLS/grants and trusted database role; host and proxy
configuration; physical data locations; SMS provider pricing/delivery; and real
notification retries. The document gate checks configuration completeness,
not the truth of contractor details or legal adequacy. Those remain release
checks and no public-launch approval has been given.

The proposed service connection is trusted and can bypass RLS when it owns the
tables or is granted that database capability. Use a dedicated server-only
connection; never expose that credential in static code. Until the actual
production role/grants are inspected and rehearsed, least-privilege production
deployment is **unverified**.
