# Approved UI verification

The final evidence covers exactly 242 unique contracts: master51, dispatcher45, manager64, owner80 and system2 documentation rows. Four application roles remain unchanged. Completion denotes accepted renderer/state composition with actual evidence and supported native equivalents; it does not mean pixel identity or a green full suite on the final build.

## Source and reports

Accepted source: `30e9373310f9e66bb63dd130378f53b86c0cc3f7`, runtime `8db611d1fc9cd27917d7`. Final memo-only presentation source: `cfd6740b2f92e56e7a9a6063fa19e0ee737391b5`, runtime `cdd3ea4f917ba89765d0`. Fresh `git fetch origin main` succeeded; `origin/main` remains `736c819a388e3b973a81c55f53a2a4832d9c1054`, an ancestor of feature HEAD. Final docs/captures commit will be the handoff commit; app source is pinned above.

| Run | Exact result | Evidence |
| --- | --- | --- |
| Build / build:check, accepted runtime | exit0 / exit0, 8db611d1fc9cd27917d7 | recovery/task6-build.log, task6-build-check.log |
| Complete Node suite, once | 729 pass,0 fail/skip/cancel/todo;6828.99622ms | recovery/task6-node.log |
| Complete safe browser baseline, once | 698 cases,622 pass,76 fail,0 skip/flaky;967775.5ms, exit1 | [full-browser-summary.json](stage-6/full-browser-summary.json), preserved full raw JSON/log |
| Regenerated exact original failures +4 role checks | 80 cases,76 pass,4 fail,0 skip/flaky;127164.653ms | [recovered-focused-summary.json](stage-6/recovered-focused-summary.json) |
| Four remaining readiness/locator cases | 4 pass,0 fail/skip/flaky;6689.15ms | [recovered-close4-summary.json](stage-6/recovered-close4-summary.json) |
| Isolated main, original past-date case | 1 fail,0 pass/skip;7880.521ms, expected diagnostic failure | [main-comparison-summary.json](stage-6/main-comparison-summary.json) |
| Memo original entry RED | 1 fail,0 pass/skip;7819.307ms | [memo-before-summary.json](stage-6/memo-before-summary.json) |
| Memo four handlers and Close/Back GREEN | 1 pass,0 fail/skip;4386.974ms | [memo-after-summary.json](stage-6/memo-after-summary.json) |
| Existing price asset case, final build | 1 pass,0 fail/skip;2102.777ms | [memo-existing-summary.json](stage-6/memo-existing-summary.json) |
| Memo fix build / build:check | exit0 / exit0, cdd3ea4f917ba89765d0 | recovery/task6-memo-build.log, task6-memo-build-check.log |

The full baseline is not retroactively green. No complete suite was repeated after repairs or after the memo fix. Every original failing file/title remains in [failure-dispositions.json](stage-6/failure-dispositions.json), with baseline cause/errors, source-versus-test change, exact covering rerun status and raw-report SHA. All76 have a recorded passing covering result:72 semantic/readiness test adaptations,3 unchanged transient rerun passes,1 deterministic date fixture. The former75-case narrow selection was71 baseline cases plus4 new checks, leaving5 original cases; its lost raw report is narrative history only and is not used to close the ledger. Current regenerated selection explicitly contains all76 exact titles plus4 new cases.

The five initially considered unrelated cases were examined rather than excluded. Calendar owner context-destruction, finance manager initial refresh, and master-home ambiguous fetch rejection pass unchanged in the exact regenerated runtime; their transient root cause remains unproven. Owner-dashboard refresh waited for the real enabled button rather than invoking an in-flight disabled refresh; original empty-master/list assertions pass. Master-home agreement used a date that became past; the identical original case fails on isolated latest main with `Нельзя договориться на прошедшую дату`. Only fixture date changes to2099-09-10; agreement payload, save and regrouping assertions remain. The new master footer check uses actual scroll/hit proof, not mere visibility.

## Commands and isolation

Complete baseline commands (old workspace paths are original provenance):

```sh
npm run build > ../recovery/task6-build.log 2>&1
npm run build:check > ../recovery/task6-build-check.log 2>&1
node --test tests/*.test.cjs > ../recovery/task6-node.log 2>&1
BOS_QA_ROOT=$PWD BOS_QA_OUTPUT=/workspace/scratch/59eaed6e4f64/recovery/task6-full-browser PLAYWRIGHT_JSON_OUTPUT_NAME=/workspace/scratch/59eaed6e4f64/recovery/task6-full-browser-results.json npx playwright test -c ../offline-playwright.config.cjs --workers=2 --reporter=line,json > ../recovery/task6-full-browser.log 2>&1
```

Test/runtime source stayed fixed until the full browser run finished. The line log stopped advancing at284/698 while worker/output directories continued; it was not interrupted. Final JSON gives the authoritative698-case counts. Two live GAS specs, `gas-archive-health.spec.js` and `gas-bridge-health.spec.js`, were deliberately not run; they are not counted as skipped.

Current recovery commands:

```sh
node scripts/qa/run-original-failures.cjs > ../recovery/task6-recovered-focused-runner.log 2>&1
BOS_FINAL_RUN=recovered-close4 BOS_FINAL_FAILURE_SUMMARY=docs/approved-ui/stage-6/recovered-focused-summary.json node scripts/qa/run-original-failures.cjs > ../recovery/task6-recovered-close4-runner.log 2>&1
BOS_QA_ROOT=/workspace/scratch/73e5936a7e6d/task6-main-comparison BOS_QA_PORT=4174 BOS_QA_OUTPUT=/workspace/scratch/73e5936a7e6d/recovery/task6-main-comparison PLAYWRIGHT_JSON_OUTPUT_NAME=/workspace/scratch/73e5936a7e6d/recovery/task6-main-comparison-results.json npx playwright test -c ../offline-playwright.config.cjs tests/master-home-tabs.spec.js --workers=2 --reporter=line,json -g 'home result and agreement move an undated order to its saved day without reload' > ../recovery/task6-main-comparison.log 2>&1
BOS_QA_ROOT=$PWD BOS_QA_OUTPUT=$PWD/../recovery/task6-memo-before PLAYWRIGHT_JSON_OUTPUT_NAME=$PWD/../recovery/task6-memo-before-results.json npx playwright test -c ../offline-playwright.config.cjs tests/approved-master-memo.spec.js --workers=2 --reporter=line,json > ../recovery/task6-memo-before.log 2>&1
npm run build > ../recovery/task6-memo-build.log 2>&1
npm run build:check > ../recovery/task6-memo-build-check.log 2>&1
BOS_QA_ROOT=$PWD BOS_QA_OUTPUT=$PWD/../recovery/task6-memo-after PLAYWRIGHT_JSON_OUTPUT_NAME=$PWD/../recovery/task6-memo-after-results.json npx playwright test -c ../offline-playwright.config.cjs tests/approved-master-memo.spec.js tests/master-price-memo.spec.js --workers=2 --reporter=line,json > ../recovery/task6-memo-after.log 2>&1
BOS_QA_ROOT=$PWD BOS_QA_OUTPUT=$PWD/../recovery/task6-memo-existing PLAYWRIGHT_JSON_OUTPUT_NAME=$PWD/../recovery/task6-memo-existing-results.json npx playwright test -c ../offline-playwright.config.cjs tests/master-price-memo-v131.spec.js --workers=2 --reporter=line,json > ../recovery/task6-memo-existing.log 2>&1
```

The first memo GREEN command's second filename did not match an existing spec; JSON truthfully contains only the new case. The corrected exact existing asset spec then passed separately. `run-original-failures.cjs` preserves generated exact arguments and selected title mapping in recovery command JSON. All browser test commands use two workers, explicit line/json reporters and JSON paths, the same deny-external offline contract. `scripts/qa/offline-playwright.config.cjs` and `deny-external-proxy.cjs` are durable tracked recovery infrastructure; sibling config is a shim. Local health proxy never forwards external requests; browser route fixtures deny or synthesize all nonlocal requests. Isolated main was extracted via Git archive into a separate checkout/server using original tests/fixtures; feature was never reset/switched. `npm ci --offline` failed ENOTCACHED; subsequent `npm ci` restored exact lockfile dependencies. Existing browser cache1193 was reused.

## Visual and workflow evidence

[Capture manifest](stage-6/capture-manifest.json) is an established array with role/screen/width/path/synthetic/state/commit/runtimeBuild. It contains 226 actual captures, no gap entries, 225 separate health measurements, and source/build counts in [capture-health-summary.json](stage-6/capture-health-summary.json). Actual capture hashes are in [capture-file-hashes.json](stage-6/capture-file-hashes.json). Most final major-section captures retain8db; the corrected memo captures and sequential PDF probe recordcdd. Historical stage2–5 paths are rebased to identical restored Git bytes while preserving originalPath, commit and recorded runtime; unknown historical builds remain null. No PNG count is used to infer242 completion.

78 approved/actual major-section pairs and8 fresh contact sheets cover mobile390 and desktop1440 for all four roles, including master desktop. 74 additional360/430/768 pairs use accepted evidence or affected fresh memo captures, preserving source/build. Master canonical has only360/390/430: its desktop pairs explicitly compare the approved390 composition against actual1440, not an invented approved desktop. Each contact sheet was visually inspected; fresh memo was corrected after inspection exposed Profile in its place. Latest flat auth is used, replacing obsolete intermediate Task5 auth montages. Canonical and implementation differ in fixture data, retained native dialogs/controls and documented supported equivalents. Retained draft editor versus saved-hours summary, and management desktop density/unused width, remain accepted minor limits.

Independent role navigation covers85 records across360/390/430/768/1440:0 page exceptions,0 local404,0 document overflow. Stage6 capture measurements separately report0 page exceptions,0 local404 and0 measured overflow. Management native create submits were scrolled and hit-tested; master footer initial/end actions were checked. Long management review actions remain visible and unoccluded in12 long-initial/middle/end states; create/edit initial/end evidence is retained. Owner active/archive selected headings/chips and exact permitted statuses were recorded; opsNew has no dedicated native selected chip, so actual membership is checked against original BOS_OPS_IS_NEW. Empty new queue is a real fixture result, not fabricated content.

[Diagnostic dispositions](stage-6/diagnostic-dispositions.json) preserves13 original geometry flags. Twelve finance flags were hidden month buttons inside closed details; specific DOM probes for all three finance tabs, both roles and both widths show checkVisibility false. The harness now excludes such hidden controls. One real initial mobile dispatcher PDF button overlaps bottom navigation; an explicit scroll followed by actual original button trial-click succeeds, with a separate scrolled capture. The export was not triggered. Initial overlap is not erased or described as universally unobstructed. Ordinary offscreen actions remain observations; measured overflow alone is not universal usability proof.

Loading/empty/error/offline, report upload acknowledgement/error/uncertain retry, saved drafts, Back/reload, workflow confirmation/save, claims, schedule payloads, report correction/deduction/payout/archive semantics and PWA update behavior use the accepted stage2–5 evidence plus named baseline/current case assertions. Semantic locator repairs follow actual native destinations and preserve meaningful handler/payload/formula/status assertions. The memo fix exposes four existing guarded callbacks and preserves original material API/data logic; the new test invokes each and proves Close/Back. No real external business action was sent.

## Protected behavior, recovery and limits

Original stage5 checker remains in evidence:229 comparisons, one expected whole-source difference for the memo presentation file. [Memo presentation boundary](stage-6/memo-presentation-boundary.json) inverses only the new menu and entry onclick and proves the entire original file equals accepted source. Final whole-runtime/backend comparison has250 checks,4 authorized presentation/generated differences and0 unexpected changes; original callback/function proofs remain unchanged. Backend/API/DB/RLS/RBAC/auth/roles/payroll/finance/report lifecycle/Hands/Avito/storage/jobs remain untouched. Final release allowlist has48 frontend files against merged main.

Platform scratch cleanup destroyed historical new commit2ab0f8e and narrow raw reports; their counts are narrative history only. Full baseline/Node/build raw bytes survived controller durability. Verified Git bundle restored exact30e runtime; current tests/tools were reconstructed, committed and all76+4 rerun. No source behavior was guessed. One evidence-only overlap of schedule capture and occlusion probe caused a manifest overwrite; no runtime edits occurred. The PDF probe was rerun sequentially, final manifest/file hashes verified, and its actual source/build retained. Subsequent build/test/capture operations were sequential.

Local Chromium fixture evidence does not certify hosted Preview, physical devices, real login, real installed PWA/push permissions, live GAS/Hands/Avito, actual Russian server or production readiness. Hosted browser QA was unavailable because the required Sites/control-browser capability was absent. Controller owns private read-only synthetic Preview and independent gate. User scope is Preview then STOP; no push/PR/main merge/deploy/server write happened in this task.

## User review checklist

- Review each role's mobile/desktop contact sheets and the242-row matrix, especially supported native equivalents.
- Check long detail/report/form actions, real filter destinations, corrected memo categories/Back and initial-versus-scrolled PDF evidence.
- Inspect all76 failure dispositions and distinguish full baseline outcomes from narrow closures and final memo-only verification.
- Review accepted density/saved-hours minors and private Preview separately. Production remains closed pending explicit future authorization and release guards.
