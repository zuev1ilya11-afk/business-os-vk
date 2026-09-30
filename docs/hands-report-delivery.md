# Accepted reports → Hands.ru

Only a new approval of a linked Hands order captures an immutable report snapshot.
The capture and local approval commit together. No historical backfill is performed.
Google Drive archiving and existing report/payroll rules remain unchanged.

The private queue wakes a machine-only `hands-report-api` worker through pg_net after
commit; a minute cron recovers missed wakes. The worker downloads the accepted
document/photos from the exact current-report Storage path using server credentials.
Expired signed URLs are therefore harmless. Credentials never cross to another
origin; redirects are rejected and each file is limited to 10 MB with a 12s deadline.
Filenames retain the actual declared MIME extension, including image acts.

Confirmed files are persisted one at a time. After files, the worker sends
`COMPLETED / SUCCESS` with the accepted work, extras, unfinished items and reviewer
comment. It does not change prices in Hands or payroll in Business OS. Measurement
receipts use their measurement document. No artificial production report is sent
for verification.

An exclusive lease and durable intent precede every provider POST. Timeouts, network
errors, 5xx and crash-after-send results are held for operator inspection; they are
not automatically replayed. Storage failures and explicit 429 rejections back off.
The queue cannot provide exactly-once provider delivery without provider idempotency.
The order card shows the uncertain filename/report step. After checking Hands, an
operator can confirm that it arrived and continue, or confirm it did not and retry.
Confirmed preceding files are preserved. Each operator action compares the queue
version; stale clicks and duplicate accepted receipts cannot enqueue another send.

Authentication remains in `order-lifecycle-api`: only active owner, manager and
dispatcher sessions can view/reconcile delivery. Master/browser database roles
cannot access the private queue, runtime credentials or worker RPCs. The worker
uses a random Vault capability and the existing `HANDS_API_KEY` environment secret.
The existing Hands webhook/handler is deliberately not redeployed.

Release sequence: pass server, browser, frozen Deno and disposable PostgreSQL gates;
apply `20260930195125_hands_report_delivery.sql` (disabled); deploy worker; run its
authenticated read-only `probe` to verify Hands connectivity/routes; deploy reviewed lifecycle
changes; publish frontend; execute `hands-report-activation.sql`. Disable delivery
by setting `bos_hands_private.runtime.enabled=false`; no queue history is deleted.

SQL contracts cover duplicate migration, no backfill, capture/snapshot, leases,
stale steps, crash ambiguity, explicit reconciliation, cancelled receipts, ACLs and
failed pg_net wake-ups. Worker tests cover provider ordering, file boundaries,
partial resume, ambiguous POSTs, lost acknowledgements and operation roles.

Provider check on 2026-09-30: authenticated GET of the order list returned 200.
Both file/report endpoints returned 405 with `Allow: POST` to OPTIONS and exposed
no field metadata. The payloads and file relations therefore follow the existing
Hands integration handler; this check does not claim a live completed-report POST.
Schema documentation URLs denied access (403) and were not used. No customer report
or dummy report was sent during rollout; the first new approval supplies the first
end-to-end provider receipt. A temporary documentation diagnostic was removed.
