# Finance and background refresh implementation plan

> Execute inline with superpowers:executing-plans. The user's attached 50-section specification authorizes implementation, CI, merge and production verification.

**Goal:** Read-only management finances in the existing dark UI; retain successful data during refresh.

**Architecture:** Reuse authenticated bootstrap state and its existing `can_view_finance` permission. Pure aggregation reads stored amounts, never writes or recalculates historical pay. Extend the existing refresh loop and dashboard renderer rather than creating another poller.

**Tech stack:** Existing classic JavaScript, CSS, node:test, Playwright, Pages BUILD_ID pipeline.

**Spec:** User attachment `Вставленный текст(4).txt`, current dashboard screenshot and finance reference. Reference supplies layout; current app supplies theme and contracts.

## Global constraints
- No backend/schema/auth/RLS/payroll/source/workflow changes.
- Do not download history or query per master for the new page: reuse the complete, already paginated bootstrap response.
- Stored zero payouts are valid. Missing historical amounts remain unknown, never reconstructed using current rates.
- Hands company share has no canonical reader: show unavailable, never label residual revenue as profit.
- Catalog matching is exact against stored work names/serialized work lines, never comments or approximate categories. Multi-work order amounts cannot be allocated without stored line prices.
- Permission is the existing server-provided capability; previews and logout must remove finance content.

## Review focus
- Duplicate master names and inactive/deleted staff must not merge unrelated orders.
- Missing historical dates/amounts and mixed Hands/direct totals must be disclosed.
- Extra work included once; cancelled orders contribute no revenue.
- Refresh identity changes cannot expose a previous user's snapshot.
- Slow/failing refresh preserves DOM, focus, scroll, filters and open order; reconnect does not start duplicate requests.

## Task 1: Financial read model
- [x] Add failing node tests for stored pay/zero/missing, extras, cancellation, periods, grouping, catalog precision and totals.
- [x] Implement `finance-data.js`: `period`, `previous`, `records`, `select`, `aggregate`, `groups`, `workGroups`, `periodGroups`.
- [x] Run focused node tests. Expected: all pass without modifying input objects or payroll files.

## Task 2: Finance UI
- [x] Add failing Playwright navigation, permission, filter, drilldown and responsive tests.
- [x] Add `finance-page.js` and scoped CSS; role module registration and navigation use existing capability. Six sections, master-first overview/detail, shared filters, sorting, real charts, existing order modal.
- [x] Run focused browser tests; inspect desktop/mobile screenshots. Expected: no overflow or write requests.

## Task 3: Refresh
- [x] Reproduce loading flash, lost DOM and error clearing using real bootstrap fixtures.
- [x] Change `order-control.js` to retain authenticated successful rows during subsequent loading/error. Dashboard no longer treats refetch as initial loading.
- [x] Add small DOM reconciliation helper for background show; reuse current polling and update dedicated finance/home regions. Header indicator handles auto/manual runs; reconnect uses same lock/throttle. Preserve identity and mutation guards.
- [x] Run refresh and adjacent dashboard/order-control/employee tests. Expected: data and nodes retained, changed values visible, no duplicate request or cross-identity data.

## Task 4: Release
- [x] Build and build:check; focused/full required tests; fresh code review; fix findings.
- [ ] Recheck main, push branch and open PR, observe mandatory CI on exact head; ordinary merge only after green.
- [ ] Verify Pages release/build assets; report actual limits of authenticated/device checks.

## Decisions and progress
- Initial main: `15563e34974410ade42829132b643e7c1493c8b6`; no finance branch/PR exists. Fresh clone isolates this work.
- User explicitly supplied complete requirements and requested continuous execution; no repeated design or release approval requested.
- Existing API already downloads full history for the app. Finance adds no fetch. A future server aggregate API would require a separate backend change and is outside this task's constraints.

- Tasks 1–3 complete: 10 finance aggregation tests, 13 final finance/refresh/control browser gates passed; 572 full server tests passed. Initial failures reproduced missing UI, discarded nodes, incorrect work quantities and period comparisons.
- Ruling: update the old control test that required skeletons during refetch. It now requires retaining the successful snapshot while fetching and marking it stale after failure, as specified by the user.
- Independent review at `666aa8e9` identified three important issues: cross-tab finance identity, Control subtree replacement, and dispatcher decorations removed by generic refresh. Added failing browser regressions and reused existing session identity plus renderer-owned DOM reconciliation to fix them; collapsed details now retain both open and closed state. Removed duplicate online listener.
- Mobile owner/manager navigation now has six equal touch targets; Avito remains one click away. The existing five-entry expectation was updated without relaxing geometry assertions.
- Full suite caught older calendar/master-filter renderers replacing content outside normal navigation. Release is gated on correcting those ownership boundaries and rerunning the complete suite.

- Release candidate `0f7b44a93f056538d643`: build check passed, all 572 server tests passed, complete Playwright suite passed 528 tests with one pre-existing opt-in archived GAS check skipped. Calendar now preserves focused master buttons; dispatcher refresh preserves schedule cards, keyboard focus and scroll. No protected backend, auth or payroll files changed.
