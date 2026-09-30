# Production backend inventory and lifecycle test boundary

Read-only inventory: 2026-09-29, project obsropbslfwtanyspjbi, PostgreSQL 17.6. `backend-production-inventory.json` records source hashes, deployed versions and JWT settings for all 33 live functions. It contains no source, credentials or customer data. Fourteen functions match the repository byte for byte, including nine critical order/report/archive and administration handlers. Six other tracked functions differ; thirteen live functions have no repository implementation. Byte inequality is not evidence of a behavioral defect. Do not deploy those differing functions or recreate all production from this repository without a separate diff review.

The migration `20260929160000_capture_live_order_guards.sql` captures all three existing order triggers and their functions verbatim from read-only catalog queries. It preserves the rejection/reopen restart, completion attachment guards, timestamps and cancelled-order zero payouts. It does not recalculate existing rows. This PR records already-live rules; it does not apply a migration to production. Older PR #154 remains open and was not merged.

CI now runs the exact captured SQL twice in a disposable PostgreSQL 17.6 service, exercising idempotent installation, required work/measurement attachments, post-rejection shape and comment retention, resubmission, approval replay, reopen, cancellation insert/update, and timestamp updates. The minimal test schema covers this trigger contract only; a full empty-database restoration of all Supabase objects is not claimed. Local PostgreSQL is unavailable, so actual SQL validation is required from CI before merge.

The shared browser router includes the real lifecycle handler and forwards the mini-app legacy review route to it. `productionOrderGuards:true` opts critical integration scenarios into the post-trigger fixture. Other historical UI fixtures retain their existing simplified DB model. The new scenario sends authenticated API requests through real create, assign, workflow, submit, reject, resubmit and approve handlers; it verifies role/stale snapshot rejection, private financial fields, exact payouts and duplicate receipts. Google Drive remains a controlled provider boundary in that test; archive source and URL controls have separate server tests.

Before every backend release, obtain a fresh read-only `get_edge_function` export for every function and run:

```sh
node scripts/check-backend-drift.cjs /private/path/fresh-function-export.json
```

The input is an array of complete API objects with source `files[].content`. Keep it private. The checker prints only names and mismatch categories. It fails on changed/missing/new functions, changed versions/JWT configuration and mismatch between the nine critical repository sources and recorded live hashes. A planned deployment must be reviewed separately and its new live export recaptured after deployment. The committed inventory is a dated baseline, not a continuous monitor; no production management token has been installed in CI.

SQL runner: `BOS_TEST_DATABASE_URL` must explicitly point to an empty disposable database, or `BOS_TEST_POSTGRES_CONTAINER` to the CI service. It creates public.orders and rolls back. Never point it at production. The workflow follows GitHub's PostgreSQL service-container pattern: https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers.

PR #210 captured the already-live `integration-api` version 6 and `staff-admin-api` version 5 sources. The follow-up session correction aligns integration validation with the existing password issuer's 365-day lifetime, with one minute of clock-skew tolerance. The previous 12-hour ceiling rejected genuine login/refresh tokens. Signature validation, finite expiry, active-owner authorization and rejection of launch-only authentication remain required. Contract tests now obtain tokens from the real password handler for every role before calling the integration handler; fabricated one-hour sessions are not the only happy path.

Staff login and password-presence metadata remain owner-only. Only owners can change credentials, with the existing 10–128 character password limit. The frontend now offers managers staff viewing/restoration without credential editing and uses the same password limit in personal settings. Read-only staff/integration actions can use network failover; uncertain writes cannot. These corrections do not change passwords, payroll, roles, RLS or historical rows. Backend deployment and a fresh inventory capture are required separately from GitHub Pages. Five tracked differences are compiled-JavaScript-equivalent; `hands-api` still requires a separate behavioral and secret-handling review. Thirteen live-only implementations remain outside the repository.

The import correction protects accepted/completed receipts across all three import paths. Upstream changes cannot reopen them or overwrite their amounts, report attachments or archive references. External completion without local report approval is rejected by the general integration API; Hands imports remain active until local review. Updates compare the previously read status, review status and timestamp, so approval during an import produces `ORDER_CHANGED` instead of overwriting the accepted receipt. Ordinary active-order updates retain existing behavior and payroll formulas.

Production Hands v6 has a webhook and private configuration absent from the repository handler. Never deploy the repository's entire Hands handler over it. `scripts/patch-live-hands-import.cjs` accepts the reviewed private v6 export only and changes just `importOrder`; all surrounding code and configuration remain byte-identical. Keep input/output exports private. The committed fixture contains only that import routine; tests exercise the production transformation, accepted receipts, new/pending completion and concurrent approval. Re-export and verify the deployed source before recording its new inventory. Full Hands reproducibility and migration of its existing private configuration remain separate work.

Release verification (2026-09-29): `integration-api` v8 and `order-lifecycle-api` v7 match the reviewed repository sources exactly. `hands-api` v7 matches the tested private import-only patch exactly. The refreshed 33-function inventory includes `push-api` v1. The nine critical source checks pass. No migration or historical row update was applied.

Release verification (2026-09-30, PR #221): `drive-archive-api` v14 and
`order-lifecycle-api` v8 match merge `4ea6b3a04af0dbf38babca40920ca20492152456`
byte for byte. Fresh exports of all 33 functions confirm that the other 31
functions are unchanged, including their source and JWT settings. Both updated
handlers retain custom session authorization and `verify_jwt=false`. The shared
archive deadline and receipt validation do not update historical orders or
change payroll. The nine critical source checks pass with this observed
inventory. Frontend BUILD_ID remains `625a0121a5b9c7d3e38f`.
