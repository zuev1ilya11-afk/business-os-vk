# Approved Business OS UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the owner's approved six-block design in the existing frontend and prepare a tested PR without production changes.

**Architecture:** Keep classic scripts, role loaders and business handlers. Edit active render templates and add scoped presentation styles; regenerate bundles using the existing build. No new application architecture or backend interface.

**Tech Stack:** Vanilla JS/CSS/HTML, existing Node tests and Playwright fixtures.

**Spec:** `docs/approved-ui/README.md`, `docs/approved-ui/screen-contract.json`; original `/workspace/scratch/59eaed6e4f64/audit-ui/proposed/specimen.{html,css,js}` and corresponding PNGs.

## Global Constraints

- Production stays unchanged; no merge or deploy. PR creation is authorized after passing checks.
- Keep existing classic-script architecture, existing handlers, API payloads, authorization, server persistence, salary/commission/deduction formulae, lifecycle, report finalization, upload transport, photo quality and Hands/Avito actions unchanged.
- Do not modify backend, migrations, RLS, roles, auth/session modules or financial-model modules.
- Existing valid action names, DOM handler hooks and field names survive presentation changes. All visible controls must use existing real actions. No mock/demo data in runtime.
- Exact approved palette and composition in Spec; widths 360/390/430/768/1440. No body horizontal overflow, preserve form values/focus on admissible background refresh.
- Functional writes only in isolated in-memory fixtures; never production. Preserve PWA update behavior.
- Each stage commits independently after targeted functional/visual checks. Do not advance with a critical regression.

## Review Focus

- Late role scripts overriding earlier templates: test bundled startup and actual role navigation, not only standalone scripts.
- Two phone numbers, long addresses/comments, multiple works: all data remain readable and correct handlers retain values.
- Pending/rejected reports and loaded photo attachments: actual saved state, safe full-quality viewer and retry/finalization remain unchanged.
- Refresh while a field/filter is focused: preserve draft, focus, scroll and last successfully loaded data.
- Capability denied / role preview / owner acting as master: no widened visibility or authority, exit remains available.

### Task 1: Shared foundation and navigation

**Files:** Create `approved-ui.css`, `tests/approved-ui-foundation.spec.js`; modify `index.html`, presentation-only sections of `role-chrome-v83.js`; existing generated bundle/version files via `npm run build`. Add stage evidence under `docs/approved-ui/`.

**Interfaces:** Consumes existing `show(page)`, `state.page`, `BOS_PERMISSIONS`, role chrome. Produces shared `--bos-ui-*` tokens and `bos-approved-ui` body class; preserve all existing nav `data-page` hooks. Later role styles consume tokens without redefining business helpers.

- [x] Read exact system/navigation mockups, map existing nav entries and handlers. Write meaningful browser assertions for theme, 44px controls, permitted navigation and desktop/mobile geometry; watch new expectations fail on baseline.
- [x] Add shared palette/type/spacing, buttons/forms/badges/dialog/error/empty/loading styling. Implement approved mobile More and desktop sidebar using existing actions, preserving master nav and all permitted pages.
- [x] Run foundation tests plus existing navigation/responsive/auth/PWA tests that touch changes. Capture all four role shells at 390 and 1440 and inspect against approved navigation.
- [x] Build, verify `build:check`, `git diff --check`; commit stage 1 with spec/plan and evidence. Record exact test results and remaining dependencies.

### Task 2: Master workflow presentation

**Files:** Create `approved-master-ui.css`, `tests/approved-ui-master.spec.js`; modify active rendering only in `master-daily-home-v127.js`, `master-orders-v125.js` / compat, `master-order-focus-v126.js`, `master-order-compact-v71.js`, `master-order-hands-layout-v72.js`, `master-order-actions-v179.js`, `master-call-workflow-v26.js`, `master-agreement-v109.js`, `master-report-ui-v12.js`, `master-profile-summary-v129.js`, `master-money-v130.js`, `unified-schedule-v102.js` as necessary. No workflow/save/financial calculation changes. Preserve current loaders; index CSS link/build artifacts if needed.

**Interfaces:** Consumes Task 1 tokens/nav and existing classification/contact/stage/report/payroll APIs; produces approved master screen renderings using existing IDs/action handlers. No new backend contract.

- [ ] Read all master screen-contract rows, exact mobile mockups and active renderers. Map each row to existing template/action. Write failing presentation/interaction tests for card hierarchy, correct date/contact state, searches/filters and sectioned detail without removing existing functional assertions.
- [ ] Implement home Days/New/Waiting/callback/overdue/empty/error, My orders, detail, contact/visit forms, report with existing file states, schedule, full profile/payout/memo. Keep saved-progress classifier and upload/finalization handlers byte-equivalent where possible.
- [ ] Run master-home-tabs, master-confirmed-progress, report lifecycle/upload/photo, phones/multiple-work/calendar/profile tests plus new tests. Save screenshots at 360/390/430 for all master screen types, inspect approved comparisons.
- [ ] Build/check/diff-check and commit stage 2. Record blocked design fields only if existing data/API cannot supply them; retain safe existing UI for that element.

### Task 3: Dispatcher workspace and shared order forms

**Files:** Create `approved-operations-ui.css`, `tests/approved-ui-dispatcher.spec.js`; modify active presentation in `dispatcher-ui-redesign-v183.js`, compat, polish/stability, `dispatcher-unified-schedule-v187.js`, `dispatcher-horizontal-schedule-v190.js`, `dispatcher-smart-assign-v119.js`, `dispatcher-attention-v123.js`, `management-order-compact-v82.js`, `new-order-card-v104.js`, `order-create-fields-patch.js`, `dispatcher-workspace-v6.js` and related active form template owner only when necessary. Do not alter assignment/conflict/date/payload algorithms.

**Interfaces:** Consumes Task 1 tokens and existing operation handlers. Produces shared operational order workspace, sectioned create/edit/detail, assignment and timeline UI reused by manager/owner; existing `data-*`, form field IDs, payloads and actions survive.

- [ ] Map dispatcher and common-form contract rows. Add failing assertions for approved left-list/center-schedule/right-detail desktop arrangement, mobile single-column controls, labeled form sections and usable save.
- [ ] Implement attention-oriented home, filters/list/workspace, detail/edit/create/date/assign/reschedule, schedule and masters/profile. Use real existing capacity/conflict information; do not invent availability/duration data.
- [ ] Run dispatcher navigation/board/timeline/touch, create/edit/multiwork/phones, assign/conflict/date/reschedule and review tests plus new tests. Capture 390/768/1440 composition and 360/430 overflow checks.
- [ ] Build/check/diff-check, commit stage 3 and document coverage/dependencies.

### Task 4: Manager, team, finance and report review

**Files:** Create `tests/approved-ui-management.spec.js`; extend `approved-operations-ui.css`; modify rendering in `owner-dashboard-v9.js` with role-aware composition, `owner-calendar-team-v10.js`, `employee-profile-patch.js`, `finance-page.js`, `report-review-runtime-v30.js`, `report-review-patch.js`, `order-control.js` / `order-control-tasks.js` presentation only. Shared profile entry presentation may be added to role chrome without auth changes.

**Interfaces:** Consumes shared workspace/forms from Task 3. Uses existing `BOS_FINANCE`, expense module and permission functions unchanged; manager gets only existing permitted actions. Produces seven finance tabs with compact filters/period selector and mobile records.

- [ ] Read manager/finance/review/team contract and PNGs. Add failing tests for compact filters retaining values, seven tabs, mobile financial records, actionable attention dashboard and role-limited employee actions.
- [ ] Implement manager dashboard/control/schedule/team/profile, finance overview/expenses/masters/orders/sources/works/periods and expense/detail forms, report approve/reject UI using existing handlers. Preserve distinctions between base dashboard revenue, finance total and accrued vs paid.
- [ ] Run finance data/expenses/workspace, management permissions, report review/financial snapshot, team/profile and shared operational suites. Capture 390/1440 and inspect all finance tabs against approved PNGs; test 360/430/768 overflow.
- [ ] Build/check/diff-check and commit stage 4. Document any unsupported approved data element without formula/API invention.

### Task 5: Owner and remaining permitted surfaces

**Files:** Create `tests/approved-ui-owner.spec.js`; extend approved CSS; modify presentation in `owner-dashboard-v9.js`, `owner-tools-v13.js`, `owner-calendar-team-v10.js`, profile rendering, `avito-messages-v25.js`, `api-integrations-v26.js`, `hands-profile-entry-v70.js`, `notification-center-v26.js` only where exact approved composition requires it. No integration request/action changes.

**Interfaces:** Consumes management workspace/finance/team from Task 4 and existing owner tools, role preview, integration and notification entrypoints. Produces owner's complete approved navigation/screens without extra permissions.

- [ ] Map owner and integration contract rows. Add failing tests for owner dashboard hierarchy, admin tools separate from personal profile and all existing allowed destinations reachable.
- [ ] Implement owner home/full workspace/team/profile/control/tools and approved Avito/Hands/notification/memo/settings surfaces. Preserve read-mark/send/sync semantics and confirmation guards; test only fixtures.
- [ ] Run owner/preview/staff credentials/hierarchy, Avito and Hands UI, notification/PWA tests plus new tests. Capture 390/1440 and verify approved differences from manager/dispatcher.
- [ ] Build/check/diff-check and commit stage 5 with remaining coverage entries.

### Task 6: Coverage, regression fixes and release evidence

**Files:** Create/complete `docs/approved-ui/coverage.md`, `docs/approved-ui/release.md`, `docs/approved-ui/verification.md`, screenshot capture/comparison tools and regression tests in `tests/`/`scripts/` as necessary. Amend only previously touched frontend files to fix task regressions.

**Interfaces:** Consumes all prior stages and screen-contract; produces exhaustive coverage/functional matrix and visual pairs, protected-file diff check, baseline/branch/change list and safe deployment/rollback handoff.

- [ ] Reconcile every screen-contract role/state against implemented renderer, screenshot and test. Verify actual role configuration; no invented fifth role. Exercise loading/empty/error/offline, long data, form drafts, Back/reload and PWA updates.
- [ ] Run build, build:check, complete server and Playwright suites. Record exact passing/failing/skipped counts; do not fake real-device/auth/server verification. Tests may use existing local edge fixtures; production writes forbidden.
- [ ] Compare actual renders at 360/390/430 and management 768/1440 to canonical approved PNGs. Fix task-related regressions and preserve meaningful functional test assertions when approved labels/layout change.
- [ ] Produce approved/implementation visual evidence, affected-file list and protected-surface diff. Document production drift, frontend-only versioned release with exact backup/hash guards and rollback; no deployment performed.
- [ ] Commit stage 6; fetch current main, verify conflict-free ancestry. Root controller independently reviews branch, pushes only feature branch, creates PR and waits for required `smoke` CI; no merge/deploy.
