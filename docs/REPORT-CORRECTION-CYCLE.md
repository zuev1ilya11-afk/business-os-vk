# Report correction and final-state UI — 2026-09-30

Baseline: production main `edc25bc4778ad56f3a782166b85d6bcca0326d22`.

The end-to-end browser check uses separate reviewer and master sessions sharing
one disposable order. Actual Edge Function handlers run against the in-memory
database, including the production order-trigger contract. Storage transfer and
the Drive provider are fixtures. No production order is modified by these tests.

## Reproduced finding

Rejection with a mandatory reason, master correction, and final acceptance all
completed successfully. After acceptance the master card still said “ЗАЯВКА
НАЗНАЧЕНА” and provided no explicit accepted-report notice. All three full-cycle
cases failed the final acceptance-display assertion before the fix.

The v179 decorator replaced the earlier workflow status heading with a label
based only on the presence of a scheduled date. Completed or cancelled cards
without a schedule also instructed the master to arrange an appointment.

## Minimal change

- Display completed/cancelled headings from the order status.
- Show “Отчёт принят” only for an explicitly approved report on a non-cancelled
  order. Historical completion alone does not prove report acceptance.
- Remove appointment instructions from closed orders without a schedule.
- Rebuild the existing startup bundle and BUILD_ID/integrity assets normally.

No API, authorization, payroll formula, database trigger, or service-worker
algorithm is changed.

## Regression coverage

`tests/report-correction-cycle.spec.js` covers owner and dispatcher review at
390px, owner review at 1280px, and a separate master session at 390px:

1. Submit the first report with an act and photo.
2. Reject an empty reason without changing the order.
3. Reject with a reason, preserving escaped literal text for the master.
4. Enforce the production-trigger reset and the repeated ordered work stages.
5. Submit a new report token; clear the old rejection comment.
6. Approve the displayed report exactly once and use the new-report payout
   contract unchanged.
7. Verify the accepted state, disabled actions, and session restoration after
   reload. No second archive call occurs.

Two additional cases guard historical completion without report acceptance and
a cancelled order carrying an old approved-review value.

Related checks cover stale review snapshots, report submission, trigger flow,
payroll, master actions, session logout/restore, mobile login fallback, PWA
installation and build updates. CI remains the release gate for the complete
server/browser suite and disposable PostgreSQL trigger tests.

## Remaining evidence limits

Read-only production checks on 2026-09-30 found push runtime enabled with its
required configuration present, but zero device subscriptions and zero delivery
records. This does not verify delivery to a physical phone.

The two previously identified historical completed reports still lack archive
URLs. Searches for both internal and external order-number folder names found no
matching active folders in the accessible configured Drive archive root. Their
historical files and financial values have not been changed.

Netlify HTML injection is tracked separately in support ticket 1132848. The
existing PWA shell-integrity check remains intact. Physical Android/iOS,
operator/VPN and IPv6 validation remains outstanding; Chromium viewport tests
are not evidence of those environments.
