# Master payroll contract — audit A01

Owner approval: 2026-09-29. Applies to new report calculations; no historical batch update.

`amount = original_amount - uncompleted_work_amount`

`master_payout = round(amount * 0.85 * 0.65, 2)`

`salary = master_payout + extra_work_amount`

No 6% is withheld from the master. Extras remain a separate field and are added once by salary readers. `amount` already reflects unfinished work; readers must not deduct it again. Existing two-decimal storage rounding remains. Manager and dispatcher calculations are unchanged.

Examples: 1000 → 552.50; 1000 minus 200 unfinished → 442; with 300 extras → 742 total. Payout becomes earned salary through the existing completion/review flow, not merely because a pending report contains the calculated amount.

## Deployment scope

Deploy only `order-lifecycle-api` and `report-api` from the reviewed merge commit, preserving `verify_jwt=false` and the existing custom signed-session checks. No SQL/RLS/migration or integration enablement.

Pre-change deployed versions: lifecycle v1 and report v14. Lifecycle source differs from main only in formatting/comments and the corrected factor. Live report also lacks the master response filter already present in main. Deploying the reviewed main report restores that existing contract: internal base/owner payout fields are omitted from the master response, while `master_payout`, extras and report fields remain. Current bootstrap already uses this boundary. Test both report actions and role bootstrap before deploying.

No mass recalculation, no automatic repair of old rows, and no change to manually adjusted historical values. Existing readers may already recompute older master displays; reconciliation of historical stored amounts versus displayed amounts is a separate audit item, not solved by changing new report writes.

## Verification and remaining scope

`report-payroll-contract.test.cjs` executes both real Edge handlers (including legacy upload/finalize), stored/read consistency, extras, partial work, rounding, invalid inputs, ownership, reject/resubmit/approve and preservation of unrelated historical rows. The browser test consumes actual handler writes through bootstrap and checks day/week/month totals, pending versus approved, and duplicate refresh.

The in-memory database does not execute SQL triggers. The rejected-row fixture explicitly represents the read-only verified production trigger result. This is not a Postgres integration test. Production verification must compare deployed source to merge and check live health/auth rejection without changing customer orders.

A02/A03 (legacy completion paths and terminal-report replay), A14 (lifecycle serializer), historical reconciliation and the wider backend drift audit remain separate work.
