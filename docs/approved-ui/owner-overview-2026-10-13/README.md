# Owner overview — 13 October 2026

Base: `c147a02` (current GitHub main; includes restored master profile schedule).
Branch: `fix/owner-dashboard-approved-layout`.

## Scope

Only owner home markup and scoped CSS changed. Four separate KPI cards; today orders and reports/control share the first content row; the existing seven-day schedule is expanded at full width; corrections, finances, quick actions and day results follow. The manager layout, sidebar, mobile navigation and all existing click handlers are preserved. Financial calculations, schedule calculations, auth, roles, backend, database and integrations are unchanged.

Other existing indicators remain available in a disclosure at the bottom. Recent report shortcuts remain in a disclosure; the queue is also reachable through its original heading and header button. The finance link now belongs to its card.

## Verification

- Build and build:check passed; JavaScript syntax and git diff whitespace checks passed.
- Four calendar unit tests passed.
- 45 distinct targeted Playwright tests passed (7 dashboard tests, 37 existing owner/management regressions, one empty-report/archive regression). Final rerun of the three new tests passed; zero retries/skips.
- Widths checked: 360, 390, 412, 430, 768, 1024, 1366, 1440, 1920 CSS pixels. Mobile 412×915 is a representative Android viewport, not certification on a physical Huawei Pura 70 Pro.
- Existing order, report queue, corrections, control filters, new-order form, team, schedule/day and finance transitions exercised. Opening/navigating did not write orders in the in-memory tests.
- Empty data, conflicts, stored zero payout, 25 masters, archive link and Moscow midnight tested.
- Separate scoped review found an overlapping empty-report label when an archive exists. A failing visual geometry regression reproduced it, the CSS selector was corrected, and the test now passes. No other blocking finding.

No lint script is defined in this repository. The first full GitHub CI run (38440899530) passed all build/server stages and exposed nine browser failures: stale owner-home labels/structure, report shortcuts now inside a disclosure, and three desktop control buttons below the existing 44px minimum. Test navigation/assertions were aligned with the approved layout; the desktop buttons were restored to 44px. All nine failures plus six related layout/responsive scenarios passed locally after this fix (15 tests, zero retries/skips). Screenshots were refreshed from that run. No auth or report-processing logic changed. Full CI reruns on the updated PR.

## Comparison with the approved image

The section arrangement, separate dark cards, full-width load table and restrained accents follow the approved image. Existing typography, sidebar and service toolbar are preserved, so spacing is not pixel-identical to the generated reference. KPI trend percentages shown in the reference are intentionally absent because the application does not calculate them. The existing six-item today list limit and active-first ordering are preserved. Below 1400px, quick actions/day results move to the following row; on mobile, sections stack and the seven-day table scrolls inside its card. At 1366×768 the schedule starts below the initial viewport; it is expanded and accessible by ordinary page scrolling.

Screenshots use synthetic test data and include exact viewport captures and full-page companions. Production code uses its existing application data. The separate hosted Preview also uses its established isolated read-only fixture adapter; live saves and integrations are not certified there.

## Release boundary

Preview was approved and upload to the feature branch was authorized. PR #287 targets main; merge and Russian production deployment remain outside this approval.
