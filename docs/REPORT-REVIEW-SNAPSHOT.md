# Review the displayed report

Approval, rejection and manual archive requests carry `expected_report_token`
and `expected_report_uploaded_at`. The review modal captures both values when
it opens. Background bootstrap updates do not replace that snapshot.

Lifecycle and Drive validate the snapshot before side effects, including an
approved/archive receipt. The timestamp distinguishes a resubmission that
reuses a token. Lifecycle forwards the same identity to Drive and preserves its
409 conflict response. Existing compare-and-set writes still guard concurrent
row changes. A repeated rejection of an already rejected row remains a read-only
receipt because the deployed SQL trigger clears report identity on rejection.

`reviewReport` and `updateOrder` no longer qualify for automatic network replay.
Transport failure or timeout prompts the user to refresh and inspect the result
before resubmission. A gateway's explicit 404 `SERVICE_NOT_ALLOWED` or
`UNKNOWN_SERVICE` is a pre-forward refusal and still permits another route.
Review and manual archive receive a 90-second request deadline to allow archiving; login deadlines
are unchanged. Timing out cannot guarantee cancellation of server-side work.

Deployment order: publish the client first; then deploy lifecycle (which sends
the snapshot to Drive); then deploy Drive. Old open/cached clients fail closed
with 409 and need a refresh. No database migration or historical recalculation.
This does not create an atomic transaction across Postgres and Google Drive;
the external-write limitation documented in REPORT-ATTACHMENT-BOUNDARY.md remains.

Verification includes actual handler tests for stale/missing snapshots and
approved receipts, browser tests with an open modal and newer background state,
and transport simulations proving no cross-route replay after ambiguous errors.
