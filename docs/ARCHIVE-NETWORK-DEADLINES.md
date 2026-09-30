# Archive network deadlines

The archive request previously bounded each attachment separately but did not
bound the Google Apps Script response headers or body. Approval awaited that
request without its own deadline. A bridge response containing `ok: true` but
no usable folder URL also wrote `drive_archive_status: archived`.

The archiver now shares a 60-second network budget across attachment reads and
the bridge response, including its body. Existing 15-second per-file and byte
limits remain. The approval call has a 75-second deadline, leaving room between
the archive budget and the existing 90-second client review deadline. These
are failure ceilings, not targets for normal response time. Database queries
are not covered by the archiver's network timer.

An HTTPS folder URL is required before recording a successful archive. A
missing or unusable receipt returns 502; an exhausted deadline returns 504.
No automatic resend is introduced. On an ambiguous timeout the user is told to
refresh the order before retrying: cancelling fetch does not roll back work
already accepted by Google Drive. Existing report-version compare-and-swap
checks and the requirement to archive before approving remain in force.

Rejection does not contact the archive provider. An existing archived receipt
also does not issue another provider request. Payroll, roles, RLS and historical
order data are unchanged.

`tests/archive-network-deadline.test.cjs` runs the real handlers with isolated
data. It covers missing/unsafe receipts, stalled headers and response bodies,
the shared time budget, approval timeout propagation, rejection and archived
receipts. Timers are accelerated in tests; those durations are not production
performance measurements.

Production source hashes and versions must be read back after deployment and
the backend inventory updated from those observations, not guessed in advance.
