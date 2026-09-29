# Completion and role response boundary

A newly submitted report remains `В работе` / `pending`, with no completion
timestamp, through both current and legacy submission routes. `createOrder` and
`updateOrder` cannot transition an order to `Выполнена`. An ordinary edit of an
already completed order preserves its original completion timestamp.

The legacy `mini-app-api.reviewReport` endpoint forwards the authenticated
request to `order-lifecycle-api`; it no longer writes its own approval decision.
Lifecycle approval requires a confirmed Drive archive status and URL before its
conditional completion write. A failed or incomplete archive response leaves
the report pending. Existing approved receipts are returned without rewriting
history. The existing explicit reopen/rejection workflow is preserved.

Lifecycle master submission responses and same-token receipts omit `amount`,
`original_amount`, `manager_payout`, and `dispatcher_payout`, matching report-api.
The assigned master's payout and extras remain available, including owner preview.
This does not alter stored financial values or the payroll formula.

Tests execute the real mini-app and lifecycle handlers across a mocked HTTP
boundary. They verify role authentication, archive-before-approval, refusal of
manual completion, incomplete archive responses, retry timestamps and master
response fields. The external Google Drive call is mocked; no customer orders
are mutated during production smoke.
