# Task 4 implementer report

Status: **DONE**. Source base `12f4472962c342e64ada480b855e50bfe052cad5`; source checkpoint `e0b0815566501d3ec46c767a48fbd0e9fd013932`; runtime `4f3606fd602885cd223f`. Branch `feat/approved-ui-redesign`. No production/push/PR/merge/deploy or external business writes.

## Changes

- Manager/owner role dashboard: joined primary metrics, trusted existing attention actions, source-backed master load rows, original seven-day load disclosure and original lower dashboard/review/actions. Dashboard base-only revenue remains separate from finance total including extras.
- Team/member/profile/access/admin/memo/manual surfaces: role-scoped composition and original fields/actions. Manager profile entry now delegates the existing role profile and exposes the original login-settings action; role/capability guards remain. Team search only filters rendered staff locally. Saved upcoming visits use explicit Moscow time, with no duration/availability inference. Accrued payroll label now says Начислено; confirmed payments remain —.
- All seven finance tabs: compact retained filters/period, joined overview KPIs, original totals under accessible disclosures, daily overview revenue/chart composition, mobile records and original desktop columns, expense/master detail and original forms/actions. Expense summary uses selected-period total/count. No formulas changed.
- Review: result grouping, labeled existing reviewer comment, original reject validation and approve/reject snapshot/finalization payloads retained. Main act inline viewer, intake-date fix and service-worker document-route handling survive.
- Scoped shared control presentation retains original issue classification, assignment/reminder dialog, permission checks and payloads. Shared operational manager/owner routes reuse Stage 3 renderers and are captured with those roles.

Source files: `approved-operations-ui.css`, `owner-dashboard-v9.js`, `order-control.js`, `finance-page.js`, `team-roles-fix-v31.js`, `staff-permissions-calendar-v43.js`, `employee-profile-patch.js`, `role-chrome-v83.js`, `report-review-patch.js`, `report-review-runtime-v30.js`; build-generated version/index/SW/startup bundles. Tests: new `tests/approved-ui-management.spec.js`; presentation/navigation-only updates to finance page/expense, employee payout, control/section and unified schedule tests. All existing value, handler, permission, payload and readiness/state assertions retained.

Source commits: `b5f4575` initial management/finance implementation; `49cd9e6` finance visual spacing/dividers; `e0b0815` full-width desktop employee rows and mobile form styling. Final evidence/report commit follows this source checkpoint.

## TDD and test evidence

All browser commands run from this repository using `BOS_QA_ROOT=$PWD`, isolated config `-c ../offline-playwright.config.cjs`, local Chromium and external-network isolation. Final browser runs use **2 workers**, with no concurrent capture/browser-suite execution. Exact stdout logs and JSON reports are in `/workspace/scratch/59eaed6e4f64/recovery/`.

RED:

```sh
BOS_QA_ROOT=$PWD BOS_QA_OUTPUT=../recovery/task4-red npx playwright test -c ../offline-playwright.config.cjs tests/approved-ui-management.spec.js --workers=3
```

9 cases: 5 expected failures (compact controls, mobile paid distinction, actionable dashboard/role title, manager employee composition, reviewer label), 4 existing-width passes. Initial GREEN: same new suite 9/9. Later profile open/settings/back coverage added; final suite contains 12 cases.

Concrete desktop visual RED:

```sh
BOS_QA_ROOT=$PWD BOS_QA_OUTPUT=/workspace/scratch/59eaed6e4f64/recovery/task4-team-red npx playwright test -c ../offline-playwright.config.cjs tests/approved-ui-management.spec.js -g 'desktop employee rows' --workers=2
```

2 expected failures: employee row width 571 versus container 1142. After fixing inherited two-column layout, final 12-case suite passes both geometry and original master-profile opening.

Fresh affected regression (runtime `75cdd8e532a989cbb159`, source subsequently checkpointed at b5f4575):

```sh
BOS_QA_ROOT=$PWD BOS_QA_OUTPUT=/workspace/scratch/59eaed6e4f64/recovery/task4-final-focused PLAYWRIGHT_JSON_OUTPUT_NAME=/workspace/scratch/59eaed6e4f64/recovery/task4-final-focused-results.json npx playwright test -c ../offline-playwright.config.cjs tests/approved-ui-management.spec.js tests/finance-page.spec.js tests/finance-expenses.spec.js tests/order-control.spec.js tests/unified-schedule-v102.spec.js --workers=2 --reporter=line,json
```

**37/37**, exit 0, 29.5s; zero skipped/flaky/unexpected.

```sh
BOS_QA_ROOT=$PWD BOS_QA_OUTPUT=/workspace/scratch/59eaed6e4f64/recovery/task4-remaining PLAYWRIGHT_JSON_OUTPUT_NAME=/workspace/scratch/59eaed6e4f64/recovery/task4-remaining-results.json npx playwright test -c ../offline-playwright.config.cjs tests/critical-team-workflows.spec.js tests/employee-profile-payout-v148.spec.js tests/staff-admin.spec.js tests/report-review-snapshot.spec.js tests/report-review-received-date.spec.js tests/management-order-delete-v100.spec.js tests/manual-completion.spec.js tests/control-tasks-v2.spec.js tests/order-control-section.spec.js tests/order-control-refresh.spec.js tests/employee-live-refresh.spec.js tests/dispatcher-profile-return.spec.js tests/approved-ui-dispatcher.spec.js tests/dispatcher-horizontal-schedule-v190-owner.spec.js tests/admin-session-ui-contract.spec.js tests/master-profile-preview-v133.spec.js tests/master-profile-payout-regression.spec.js --workers=2 --reporter=line,json
```

**70/70**, exit 0, 58.1s; zero skipped/flaky/unexpected. Combined fresh affected baseline: **107/107 browser cases**.

Finance spacing/disclosure adjustment (runtime `37fdc8c7653329717aa1`): new management + finance-page + finance-expenses, same config/workers/reporter, outputs `task4-finance-final.log` / `task4-finance-final-results.json`: **27/27**, exit 0, 23.5s.

Final team/modal CSS verification (runtime `4f3606fd602885cd223f`):

```sh
BOS_QA_ROOT=$PWD BOS_QA_OUTPUT=/workspace/scratch/59eaed6e4f64/recovery/task4-visual-fixes PLAYWRIGHT_JSON_OUTPUT_NAME=/workspace/scratch/59eaed6e4f64/recovery/task4-visual-fixes-results.json npx playwright test -c ../offline-playwright.config.cjs tests/approved-ui-management.spec.js tests/finance-page.spec.js tests/finance-expenses.spec.js tests/critical-team-workflows.spec.js tests/employee-profile-payout-v148.spec.js tests/report-review-snapshot.spec.js tests/manual-completion.spec.js --workers=2 --reporter=line,json
```

44 passed / 2 failed, exit 1. The new test fixture initially waited only for hidden auth gate, which can occur before auth boot finishes; finance route later returned Home. Also the new manager geometry test selected manager self rather than the permitted master. Fixed readiness to wait for authenticated body/session adapter; selected actual master row. No force clicks, weaker assertions, auth behavior or capability changes. Complete affected new suite rerun:

```sh
BOS_QA_ROOT=$PWD BOS_QA_OUTPUT=/workspace/scratch/59eaed6e4f64/recovery/task4-management-final PLAYWRIGHT_JSON_OUTPUT_NAME=/workspace/scratch/59eaed6e4f64/recovery/task4-management-final-results.json npx playwright test -c ../offline-playwright.config.cjs tests/approved-ui-management.spec.js --workers=2 --reporter=line,json
```

**12/12**, exit 0, 19.9s; zero skipped/flaky/unexpected. Includes both previously failing cases, both new desktop geometry cases and manager profile/settings/open/back. Other 34 cases in final CSS run passed. Counts above are separate runs, not inflated into a new full-suite total.

Node model/permission/snapshot verification:

```sh
node --test tests/finance-data.test.cjs tests/finance-expenses.test.cjs tests/employee-permissions-regression.test.cjs tests/dispatcher-permissions.test.cjs tests/report-review-snapshot.test.cjs tests/report-review-route.test.cjs tests/staff-access-regression.test.cjs tests/control-tasks-v2.test.cjs tests/order-control.test.cjs tests/salary-periods.test.cjs
```

**62/62**, exit 0, 555.7ms, zero failed/cancelled/skipped.

Other checks: `npm run build`, `npm run build:check` (final BUILD_ID `4f3606fd602885cd223f`); `python docs/approved-ui/stage-4/verify-protected.py` (**106 comparisons, zero changes**); `git diff --check`. npm emits existing environment-config warning; browser server emits existing aborted-client BrokenPipe/terminal-color notices. Test output is not described as pristine.

Earlier development runs: `task4-roles.log` exit 1 with incomplete stdout summary (76/92 observed at interruption of output); no assumption that remaining 16 passed. `.last-run.json` recorded failed status/IDs. `task4-roles-2.log` completed 48/50 with 2 failures. Later `task4-final-roles.log` exit 1, final stdout summary absent; `.last-run.json` recorded 3 failures. No resource termination/signal evidence was found; server BrokenPipe messages alone do not establish resource death. All completion claims use the subsequent fresh 37+70 JSON results and the necessary affected reruns above.

Existing old unified schedule test assumed default `.usScheduleCard`; base 12f4472 renderer already routes dispatcher to `.bosOpsDaySchedule`. Selector update navigates real Day → График команды → all masters → original day header and preserves full/partial/off/unknown assertions. Dispatcher control entry now uses the visible original Orders entry rather than intentionally hidden workspace summary, preserving payload/role checks. The transient accepted dispatcher calendar readability timeout was **not** classified as stale: no dispatcher renderer/test changed. Exact existing axis/readability subset reran 3/3 unchanged, then the 107-case affected run passed that whole suite.

## Captures and coverage

```sh
node docs/approved-ui/stage-4/capture-management-fixtures.cjs
BOS_CAPTURE_ROLES=dispatcher BOS_CAPTURE_WIDTHS=390,1440 BOS_CAPTURE_SCREENS=review,review-reject,control,control-task node docs/approved-ui/stage-4/capture-management-fixtures.cjs
python docs/approved-ui/stage-4/make-coverage.py
```

Both capture processes exit 0. **272 genuine application captures**, all source `e0b0815566501d3ec46c767a48fbd0e9fd013932`, runtime `4f3606fd602885cd223f`, synthetic and fixed Moscow clock explicitly marked. 360/390/430/768/1440 essential manager/owner screens and seven finance tabs; forms and operational role variants at 390/1440; dispatcher control/review role variants at 390/1440. No >1px document/body overflow, page errors or capture gaps. External requests isolated; API fixture responses use local in-memory backend, native control dialog list and explicitly DEMO-ONLY invitation response. No real invitation/control/save/delete/document fetch.

`docs/approved-ui/stage-4/capture-manifest.json` keeps role/screen/width/path/synthetic/state/runtimeBuild plus source and diagnostics. `coverage.json` / `coverage.md` cover **148 contract rows**: 64 implemented, 33 reused and role-verified, 51 explicitly deferred to controller Task 5. No missing-evidence owned row. Separate detailed canonical PNG review: `visual-review.md`. All seven finance tabs inspected at 390 and 1440, then final corrected team/form/profile/member shots inspected. No new standalone Preview project was edited.

## Limits and self-review

Confirmed unchanged backend/database/RLS, auth/session files, original employee accrual calculations (label normalization only), payroll/financial model, permission guards, control classification/handlers, report snapshot/finalization handlers, intake/act viewer helpers, Hands/Avito transport and shared operational renderers. Generated SW/index changes are build-version only; merged main fixes retained.

Unsupported proposal data is documented safely: no confirmed-payment ledger → actual paid —; no arbitrary-period week expense snapshot → selected-period total/count; no inferred visit duration/availability; unmatched works/unsaved per-item breakdown → — with original notes. Review uses existing signed links and snapshot; unavailable fixture media is not replaced with invented real documents or sizes. Native leadership deletion confirmation remains, with no invented deletion-reason API/form. Manager/owner Home retains management dashboard because existing role guard does not provide separate dispatcher-only workspace; shared Orders/Schedule/Detail remain accessible.

Self-review corrected inherited finance row borders/expense padding and desktop team compression based on actual PNGs. Tests retain business-value/action assertions. Native long forms and full original column/metric sets remain accessible rather than hiding source fields to imitate design data. Some native modals retain their original narrow outer overlay inset; no functional or overflow blocker remains. Task 5 shared auth/integration/notifications/help/personal/file/system states and controller final full suite/Preview/review are outstanding by task boundary. Parked dispatcher M1 spacing/dense schedule summary item remains final-review triage, with no unrelated source edit here.


## Fix round 1 — consolidated manager review (2026-10-11)

Status: **DONE** for Important I1, I2 and I3, from review baseline `294f0e22ba8e4c2843345516692e309b0af2b498`. Controller final suite/Preview/review remain separate gates.

I1: Kept exactly four primary dashboard KPIs. Restored the original active-master numerator/denominator, correction count, available company share and base-only average under the keyboard-accessible “Другие показатели сегодня” disclosure. Original snapshot/calendar/payroll calculations are unchanged; the 1000 base dashboard / 1100 finance fixture distinction is asserted.

I2: Runtime composition reparents the existing document/result cards into the left column and original review form/archive into the right column. Original form snapshot attributes, button objects/onclick bindings, reason validation, submitters and payloads remain. Desktop decisions stay in their sticky side column; mobile uses a fixed visible decision strip and reserved bottom scroll space. Original empty rejection brings its reason field into view on mobile. No approve/reject algorithm or permission change. Covering tests hit-test both actions at initial/middle/end scroll, assert focus order and unchanged handlers, and prove the long fixture contains 15 existing photo buttons and 14 saved deduction rows.

I3: Capture readiness closes actual filter/period disclosures, scrolls to the selected master detail, and requires heading, existing close control and all primary detail KPIs inside the viewport above the mobile navigation. Capture manifest records measured `visibleEvidence.financeMaster`; coverage excludes finance-master images without this evidence and reports `missing-visual-evidence` if absent. Four corrected manager/owner 390/1440 images were inspected against all four matching canonical PNGs. This exposed inherited zero detail KPI padding; a narrowly scoped CSS override restores joined KPI padding/dividers. Existing finance details, accrual values and unknown actual paid — remain untouched.

### Exact covering commands and outcomes

All browser commands used local isolated fixtures and 2 workers. Logs are in `../recovery/`; no production data/actions or external document retrieval.

```sh
BOS_QA_ROOT=$PWD BOS_QA_OUTPUT=/workspace/scratch/59eaed6e4f64/recovery/task4-fix1-red npx playwright test -c ../offline-playwright.config.cjs tests/approved-ui-management-review.spec.js --workers=2
BOS_QA_ROOT=$PWD BOS_QA_OUTPUT=/workspace/scratch/59eaed6e4f64/recovery/task4-fix1-green npx playwright test -c ../offline-playwright.config.cjs tests/approved-ui-management-review.spec.js tests/report-review-snapshot.spec.js tests/report-review-received-date.spec.js tests/finance-page.spec.js tests/order-control-section.spec.js --workers=2
BOS_QA_ROOT=$PWD BOS_QA_OUTPUT=/workspace/scratch/59eaed6e4f64/recovery/task4-fix1-finance npx playwright test -c ../offline-playwright.config.cjs tests/approved-ui-management-review.spec.js -g 'finance-master' --workers=2
BOS_QA_ROOT=$PWD BOS_QA_OUTPUT=/workspace/scratch/59eaed6e4f64/recovery/task4-fix1-long-review npx playwright test -c ../offline-playwright.config.cjs tests/approved-ui-management-review.spec.js -g 'long review' --workers=2
BOS_QA_ROOT=$PWD BOS_QA_OUTPUT=/workspace/scratch/59eaed6e4f64/recovery/task4-fix1-final-focused npx playwright test -c ../offline-playwright.config.cjs tests/approved-ui-management-review.spec.js --workers=2
npm run build
npm run build:check
python3 docs/approved-ui/stage-4/verify-protected.py
git diff --check
```

- RED: 15 failed, reproducing missing secondary indicators/grouping and false finance readiness. Completed failure summary in `task4-fix1-red.log`; process exit status was not retained, so it is not invented.
- First affected run: **35 passed / 1 failed**, exit **1**, 47.5s. Failure was before capture readiness: selecting master after opening tall disclosures caused a detached/out-of-view click. Fixture now selects via original button first, then opens disclosures to reproduce the evidence gap; no force click or finance implementation change. Other 21 existing dashboard/finance/report snapshot/intake cases passed.
- Targeted finance rerun: **4/4**, exit **0**, 5.2s.
- Intermediate long-content assertion run: exit **1**, six observed photo-count failures (locator expected anchors, while merged main uses the original photo buttons). Final stdout tally was not retained; remaining cases are not described as passed. Corrected selector to original `.reportPhotoThumb`, preserving explicit 15-photo assertion.
- Fresh final focused run: **15/15**, exit **0**, 14.4s, runtime **565e0956c8583e266533**. Includes both dashboards, all 9 long-review role/width cases and all four finance-master cases. Counts remain separate from prior runs; no repeat of the 107-case suite or 62 Node cases.
- Final build/check exit **0**, runtime **565e0956c8583e266533**. **107 protected comparisons, zero changes**, exit **0**, including entire original review node template/bindings against Task 4 baseline. Diff whitespace check exit **0**. Existing npm config/terminal-color warnings and blocked fixture media requests remain disclosed.

### Affected capture commands and provenance

```sh
BOS_QA_ROOT=$PWD BOS_CAPTURE_ROLES=manager BOS_CAPTURE_SCREENS=dashboard,review,review-reject,finance-master BOS_CAPTURE_WIDTHS=360,390,430,768,1440 node docs/approved-ui/stage-4/capture-management-fixtures.cjs
BOS_QA_ROOT=$PWD BOS_CAPTURE_ROLES=manager BOS_CAPTURE_SCREENS=review,review-reject,finance-master BOS_CAPTURE_WIDTHS=360,390,430,768,1440 node docs/approved-ui/stage-4/capture-management-fixtures.cjs
BOS_QA_ROOT=$PWD BOS_CAPTURE_ROLES=owner BOS_CAPTURE_SCREENS=dashboard,review,review-reject,finance-master BOS_CAPTURE_WIDTHS=390,1440 node docs/approved-ui/stage-4/capture-management-fixtures.cjs
BOS_QA_ROOT=$PWD BOS_CAPTURE_ROLES=dispatcher BOS_CAPTURE_SCREENS=review,review-reject BOS_CAPTURE_WIDTHS=390,1440 node docs/approved-ui/stage-4/capture-management-fixtures.cjs
python3 docs/approved-ui/stage-4/make-coverage.py
```

Final verified manager/owner/dispatcher processes exit **0** and have no capture gaps. Earlier scoped run exited **1** because it unconditionally clicked hidden unrelated month-period setup; scope filter now skips that branch. Another development capture exited **0** but correctly recorded 5 review gaps when semantic readiness found unchanged short content: existing refresh refuses while review modal is open. Harness now closes original modal before refreshing and waits for actual long saved description. Those gaps and misleading long images were replaced; no pass claim relies on them.

Final manifest: **333** images, comprising **87 affected fresh captures** at runtime `565e0956c8583e266533` and **246 retained unchanged captures** at original runtime `4f3606fd602885cd223f`. Fresh: 14 dashboard (initial/disclosure), 54 review (short initial/middle/end and long initial/middle/end), 15 reject/reason, 4 finance-master. Fresh source provenance is truthful: 10 manager dashboard shots from `4907b14ce52a4c1947a971bdbcd59a69b4600d55`, 77 other shots from `ddbeaca2e83bbfeae6a4c6960049285ba8928210`. Source changes after the former are capture/test-only. Old build IDs were not relabeled. Zero gaps/page errors/>1px body/document overflow; every recorded review decision probe is viewport-visible and unoccluded. Finance-master heading/KPIs/close viewport evidence passes in all four captures.

Coverage remains 148 role/screen rows: 64 implemented, 33 reused and role-verified, 51 Task 5 deferred. Finance-master can only claim evidence from the newly qualified captures. All screen IDs and role/screen/width/path/synthetic/state/runtimeBuild fields retain contract/Stage 3 compatibility.

### Fix self-review and limits

Read consolidated I1/I2/I3 against source and canonical PNGs before editing; applied receiving-code-review and verification-before-completion skills. Reviewed final diff, preserved protected original handlers/model/guards and merged main act viewer/intake helpers. Inspected real short review initial, long initial/middle/end, secondary dashboard disclosure and all manager/owner finance-master canonical pairs. Main report controls remain original, existing signed unavailable fixture media stays visibly unavailable, and no business data is invented. Native modal overlay/inset remains; approved grouping and persistent decision reachability now hold within it. Finance retains original detailed chart/order columns and close action rather than inventing unsupported proposal period tabs or payment records. Task 5, final full-suite/Preview, production approval and parked dispatcher M1 remain controller boundaries. No push/publish/production changes.
