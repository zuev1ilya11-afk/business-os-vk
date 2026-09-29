# Report submission retries

Submission endpoints (`order-lifecycle-api.finalizeMasterReport`, both legacy
`report-api` finalizers) return the existing receipt for the same upload token
while that report is pending or approved. They do not reset completion, archive,
financial or workflow fields. Ownership is checked before returning the receipt.
A different submission to a pending, approved, completed or cancelled order is
rejected with HTTP 409. A rejected report can be submitted again after the
existing database restart trigger clears its report pointers.

Writes compare the read version (`updated_at`, status, assigned master, review
status and upload token) atomically in the UPDATE filter. A concurrent edit
returns HTTP 409 and requires a refresh; a stale request cannot overwrite it.
Lifecycle review repeats return the stored decision without changing timestamps.
Opposite decisions require a pending report.

Uploaded objects use unique paths and `upsert: false`. Uploads that begin after
submission are refused. An in-flight upload can leave an unreferenced object,
but cannot overwrite a file already attached to a report.

This stage does not change the approved payroll formula or historical rows.
It does not add a database migration. Separate audit stages must still close
legacy `mini-app-api` review/completion bypasses and protect the external Drive
archive write against races. This is not a transaction spanning Google Drive
and Postgres; it does not promise exactly-once external archive creation.

Validation: real Edge handler tests cover receipts, concurrent tokens, stale
assignment/status/version, repeated approval/rejection, cancellation and object
immutability. Test queries model conditional UPDATE selection, not a live
PostgreSQL transaction or the production restart trigger.
