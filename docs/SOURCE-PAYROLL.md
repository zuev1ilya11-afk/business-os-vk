# Payroll by order source — approved 2026-10-01

Hands keeps the master calculation unchanged: master = round(amount × .85 × .65, 2). Manager and dispatcher payouts are zero. The remainder of the base amount after the master's payout is the company share. Hands is identified by external_source=hands, a hands: external id, or the exact normalized source label Hands/Руки. Integration markers cannot be overridden by a report request body. Missing-source legacy records keep their existing master calculation; manager and dispatcher payouts are no longer accrued.

Other sources: master = round(amount × .60, 2); company pool = round(amount − rounded master share, 2). No 15% or 6% deduction. Separate manager/dispatcher payouts are zero for these new calculations; no internal allocation of the company's 40% was specified. The company pool is not net profit. Unassigned orders keep a zero assigned-master payout, while pricing displays the planned company share. Historical manager_payout and dispatcher_payout values are not treated as salary anymore and are not subtracted from the company share; no destructive batch rewrite is required.

amount is the existing net cost after unfinished work, deducted once. The prior separate extras contract is retained: extra_work_amount is added once and in full to the master's base, outside this new 60/40 split. Example: original 1000, unfinished 200, extras 300 → base 800, master base 480 + extras 300 = 780, company base share 320.

The same dependency-free order-payroll.js is used by four Edge writers and frontend readers. Other authentication, API actions, integration credentials, tax settings and Hands import workers remain unchanged. No DB migration or new financial column is needed: master/manager/dispatcher amounts use existing fields; the company remainder is derived for display, not written as a second payout.

## History and concurrency

There is no batch recalculation or production test order. Submitted/accepted non-Hands reports retain stored amounts (including legitimate zero) in bootstrap, master salary summaries and operations previews. Merely reading, changing a comment or replaying an uploaded-report receipt does not reprice a row. An explicitly saved financial change uses the source rule, including a previously completed direct order. Stored reports are never repriced just because they are loaded or a comment is edited. A source change that switches schemes is refused for submitted/accepted reports. The ordinary Hands display fallback is untouched; historical reconciliation of Hands is outside scope.

New direct-source calculations happen at creation, deliberate draft repricing/source change/assignment and report submission. Existing unsubmitted direct drafts show a current 60% estimate; their old database estimate is not mass-rewritten. Report writes also compare source identity to prevent a concurrent source edit from storing a stale rate.

## Verification / deployment

Node tests execute the shared module and the real create/update, integration and report handlers; cover source aliases, rounding/conservation, base deductions, separate extras, spoofed client formulas, history, retries and source-write races. Browser tests cover the source switch at 320/1280px, company pool, historical views and real report-to-day/week/month salary flow. Existing Hands payroll checks remain intact with an explicit Hands fixture.

Release only after the complete PR CI. Deploy mini-app-api, report-api, order-lifecycle-api and integration-api with their existing custom signed-session/API-key authentication and verify_jwt=false; each deployment includes the shared root module at its relative import path. The frontend uses the existing GitHub Pages/build pipeline. No Netlify plan or hosting change is part of this task.
