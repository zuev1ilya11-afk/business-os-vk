# Master cost visibility by source — 2026-10-01

User-approved visibility change on top of source-60-40-v1. There is no new pricing rule or data migration.

For assigned non-Hands orders, the master receives the existing amount and original_amount in bootstrap, claims bootstrap, workflow actions, claim closure and report responses/receipts. Other-role payout fields remain redacted. Hands markers (external_source=hands, hands: external identity or Hands/Руки source label) and unknown-source legacy rows remain private even with contradictory client-supplied source fields. Ownership and signed-session checks are unchanged.

The existing order list shows full cost and total master payout for non-Hands orders. Its existing detail card now contains: original amount, already-deducted unfinished work, net main-work amount, extras, full customer cost, master's base share, master's extras, company remainder and total master payout. No duplicate screen or polling is introduced. The existing pay-only Hands card remains unchanged. Owner master-preview applies the same visual restriction even though the owner has raw amounts.

Example: original 1000 − unfinished 200 = net main work 800; extras 300; full cost 1100; master 480 + extras 300 = 780; company 320. Extras retain the previous 100%-to-master contract, not a newly introduced rule. Full cost is not a record of payment collected.

Saved report payouts, including zero or a manual adjustment, are displayed as stored. If the payout differs from the current 60% rate, the card labels it as a saved payout and omits misleading 60%/40% labels. A missing amount is not displayed as zero. Cancelled orders show cost for reference and an explicit no-accrual notice. No query or view rewrites financial rows.

Verification includes complete server regressions, direct/Hands boundary tests in all five affected handlers, ownership/spoofing/unauthenticated checks, report retry behavior, rounding/extra conservation, and browser scenarios at 320/390/1280px plus historical views, reload and owner preview. Screenshots use synthetic fixture data only.

Deploy the five changed handlers (mini-app-api, claims-api, master-workflow-api, report-api, order-lifecycle-api) with their unchanged custom authentication and root order-payroll.js dependency. The integration writer and all payout calculations remain unchanged. Publish via the canonical existing Pages/build pipeline; do not modify Netlify hosting or account settings.
