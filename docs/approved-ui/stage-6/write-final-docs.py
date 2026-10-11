import json,subprocess,hashlib
from pathlib import Path
root=Path.cwd();docs=root/'docs/approved-ui';out=docs/'stage-6';recovery=root.parent/'recovery'
def j(p):return json.loads((out/p).read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
h=j('capture-health-summary.json');protected=j('protected-functionality.json');release=j('release-hashes.json');drift=j('production-drift.json');coverage=json.loads((docs/'coverage.json').read_text());files=j('affected-runtime-files.json');pairs=j('visual-pairs.json');responsive=j('responsive-visual-pairs.json');source=subprocess.check_output(['git','rev-parse','cfd6740'],text=True).strip()
verification=f'''# Approved UI verification

The final evidence covers exactly 242 unique contracts: master51, dispatcher45, manager64, owner80 and system2 documentation rows. Four application roles remain unchanged. Completion denotes accepted renderer/state composition with actual evidence and supported native equivalents; it does not mean pixel identity or a green full suite on the final build.

## Source and reports

Accepted source: `30e9373310f9e66bb63dd130378f53b86c0cc3f7`, runtime `8db611d1fc9cd27917d7`. Final memo-only presentation source: `{source}`, runtime `cdd3ea4f917ba89765d0`. Fresh `git fetch origin main` succeeded; `origin/main` remains `736c819a388e3b973a81c55f53a2a4832d9c1054`, an ancestor of feature HEAD. Final docs/captures commit will be the handoff commit; app source is pinned above.

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

[Capture manifest](stage-6/capture-manifest.json) is an established array with role/screen/width/path/synthetic/state/commit/runtimeBuild. It contains {h['captures']} actual captures, no gap entries, {h['healthMeasurements']} separate health measurements, and source/build counts in [capture-health-summary.json](stage-6/capture-health-summary.json). Actual capture hashes are in [capture-file-hashes.json](stage-6/capture-file-hashes.json). Most final major-section captures retain8db; the corrected memo captures and sequential PDF probe recordcdd. Historical stage2–5 paths are rebased to identical restored Git bytes while preserving originalPath, commit and recorded runtime; unknown historical builds remain null. No PNG count is used to infer242 completion.

{len(pairs)} approved/actual major-section pairs and8 fresh contact sheets cover mobile390 and desktop1440 for all four roles, including master desktop. {len(responsive)} additional360/430/768 pairs use accepted evidence or affected fresh memo captures, preserving source/build. Master canonical has only360/390/430: its desktop pairs explicitly compare the approved390 composition against actual1440, not an invented approved desktop. Each contact sheet was visually inspected; fresh memo was corrected after inspection exposed Profile in its place. Latest flat auth is used, replacing obsolete intermediate Task5 auth montages. Canonical and implementation differ in fixture data, retained native dialogs/controls and documented supported equivalents. Retained draft editor versus saved-hours summary, and management desktop density/unused width, remain accepted minor limits.

Independent role navigation covers85 records across360/390/430/768/1440:0 page exceptions,0 local404,0 document overflow. Stage6 capture measurements separately report0 page exceptions,0 local404 and0 measured overflow. Management native create submits were scrolled and hit-tested; master footer initial/end actions were checked. Long management review actions remain visible and unoccluded in12 long-initial/middle/end states; create/edit initial/end evidence is retained. Owner active/archive selected headings/chips and exact permitted statuses were recorded; opsNew has no dedicated native selected chip, so actual membership is checked against original BOS_OPS_IS_NEW. Empty new queue is a real fixture result, not fabricated content.

[Diagnostic dispositions](stage-6/diagnostic-dispositions.json) preserves13 original geometry flags. Twelve finance flags were hidden month buttons inside closed details; specific DOM probes for all three finance tabs, both roles and both widths show checkVisibility false. The harness now excludes such hidden controls. One real initial mobile dispatcher PDF button overlaps bottom navigation; an explicit scroll followed by actual original button trial-click succeeds, with a separate scrolled capture. The export was not triggered. Initial overlap is not erased or described as universally unobstructed. Ordinary offscreen actions remain observations; measured overflow alone is not universal usability proof.

Loading/empty/error/offline, report upload acknowledgement/error/uncertain retry, saved drafts, Back/reload, workflow confirmation/save, claims, schedule payloads, report correction/deduction/payout/archive semantics and PWA update behavior use the accepted stage2–5 evidence plus named baseline/current case assertions. Semantic locator repairs follow actual native destinations and preserve meaningful handler/payload/formula/status assertions. The memo fix exposes four existing guarded callbacks and preserves original material API/data logic; the new test invokes each and proves Close/Back. No real external business action was sent.

## Protected behavior, recovery and limits

Original stage5 checker remains in evidence:229 comparisons, one expected whole-source difference for the memo presentation file. [Memo presentation boundary](stage-6/memo-presentation-boundary.json) inverses only the new menu and entry onclick and proves the entire original file equals accepted source. Final whole-runtime/backend comparison has250 checks,4 authorized presentation/generated differences and0 unexpected changes; original callback/function proofs remain unchanged. Backend/API/DB/RLS/RBAC/auth/roles/payroll/finance/report lifecycle/Hands/Avito/storage/jobs remain untouched. Final release allowlist has{len(files)} frontend files against merged main.

Platform scratch cleanup destroyed historical new commit2ab0f8e and narrow raw reports; their counts are narrative history only. Full baseline/Node/build raw bytes survived controller durability. Verified Git bundle restored exact30e runtime; current tests/tools were reconstructed, committed and all76+4 rerun. No source behavior was guessed. One evidence-only overlap of schedule capture and occlusion probe caused a manifest overwrite; no runtime edits occurred. The PDF probe was rerun sequentially, final manifest/file hashes verified, and its actual source/build retained. Subsequent build/test/capture operations were sequential.

Local Chromium fixture evidence does not certify hosted Preview, physical devices, real login, real installed PWA/push permissions, live GAS/Hands/Avito, actual Russian server or production readiness. Hosted browser QA was unavailable because the required Sites/control-browser capability was absent. Controller owns private read-only synthetic Preview and independent gate. User scope is Preview then STOP; no push/PR/main merge/deploy/server write happened in this task.

## User review checklist

- Review each role's mobile/desktop contact sheets and the242-row matrix, especially supported native equivalents.
- Check long detail/report/form actions, real filter destinations, corrected memo categories/Back and initial-versus-scrolled PDF evidence.
- Inspect all76 failure dispositions and distinguish full baseline outcomes from narrow closures and final memo-only verification.
- Review accepted density/saved-hours minors and private Preview separately. Production remains closed pending explicit future authorization and release guards.
'''
(docs/'verification.md').write_text(verification)
releaseDoc=f'''# Approved UI release handoff

User scope is isolated synthetic read-only HTTPS Preview, then STOP. This document prepares a possible future frontend release; it does not authorize or perform a production release, main merge, push, PR, server change or external integration action. Controller owns Preview publication and independent review. Current hosted Preview is a separate checkpoint and local fixture tests do not certify it.

Final application source `{source}` loads `cdd3ea4f917ba89765d0`. Baseline source30e loaded8db. Final evidence commit adds docs/tools/captures without runtime changes. Fresh origin/main fetch succeeded at736c819a388e3b973a81c55f53a2a4832d9c1054; ancestry is conflict-free. No merge is needed.

[Exact frontend allowlist and SHA256](stage-6/release-hashes.json) enumerates{len(files)} runtime files changed against merged main. [Protected comparison](stage-6/protected-functionality.json) checks250 surfaces, only4 memo presentation/generated changes against accepted runtime,0 unexpected/backend changes. Tests/fixture data/docs/captures/tooling are excluded from any production upload. No demo data is introduced in app runtime.

The controller-provided read-only production manifest is `{drift['inputPath']}`, SHA256 `{drift['inputSha256']}`. It reports build `{drift['productionBuild']}`, shell `{drift['productionShellSha256']}`,51 assets: {drift['statusCounts'].get('same',0)} same, {drift['statusCounts'].get('differs',0)} different, {drift['statusCounts'].get('missing',0)} missing versus final candidate. It is a captured manifest, not a fresh server audit or proof that repository equals current Russian runtime. No server request was made for this handoff.

## Future authorized release guards

The production gate is CLOSED. If separately authorized later, obtain the actual server document-root/release mechanism from its owner; no server path or destructive shell command is assumed here. Before changing anything, read and hash the exact live frontend allowlist, index, build-version, generated startup bundles and SW/manifest assets. Save immutable timestamped backup bytes plus `before.sha256`, permissions, release pointer, source build and the complete live manifest. Verify backup hashes match observed live bytes; abort on missing files, unexpected drift or an incomplete backup. Do not rely on this historical51-asset manifest as a current guard.

Prepare a separate versioned candidate directory from the allowlist and its required coherent dependencies. Recompute every SHA256 against release-hashes.json and the generated build manifest. Run build:check before transfer; validate that index shell, build-version, asset URLs, source-to-bundle map and SW cache/build constants agree. Preserve backend/configuration/credentials/DB/functions/jobs without edits. Review exact candidate-versus-live differences and record operator authorization.

Publish only through the confirmed atomic frontend release pointer/swap, with all immutable assets present before the shell becomes visible. No partial in-place overwrite of index/SW/version/bundles is acceptable. Validate read-only health, actual build/asset hashes, role landing routes and PWA update behavior before considering the release successful. Runtime failures,404, stale mixed build or unexpected hashes require rollback rather than live guessing.

Rollback uses the verified immutable backup and original release pointer. First hash the currently served candidate against expected after hashes; if someone else has changed it, stop and reconcile rather than overwrite unknown changes. Atomically restore the original coherent frontend, verify all before hashes/build/SW references, and record outcome. Do not roll back database/API/backend because none were changed. Retain backup until the authorized release is accepted.

## Reviewable evidence and unresolved limits

Read [verification.md](verification.md), [coverage.md](coverage.md), all76 exact failure dispositions, fresh comparisons and initial/scrolled diagnostics before a gate. Baseline complete browser run remains622/76; all76 have passing narrow closures, but no full suite was rerun on finalcdd. Memo-only RED/GREEN and existing asset test pass. Physical devices, hosted auth/PWA/push, live external integrations and deployed production remain unverified. Accepted saved-hours/draft and desktop density minors remain. The initial PDF overlap remains documented with successful scrolling/trial-click proof, not universal usability clearance.
'''
(docs/'release.md').write_text(releaseDoc)
report=root/'.superpowers/sdd/2026-10-08-approved-ui-redesign/task-6-report.md'
changed=subprocess.check_output(['git','diff','--name-only','30e9373'],text=True).splitlines();testfiles=[p for p in changed if p.startswith('tests/')];runtime=[p for p in changed if '/' not in p];report.write_text(f'''# Task6 implementation report

Status: implementation/evidence ready for controller's independent gate; production gate closed. Continued the already-approved redesign, reused accepted stages2–5, did not repeat full audit. Read task6-brief first and binding README/screen-contract. Exact242 rows complete with renderer/state/test/evidence/native equivalence: master51,dispatcher45,manager64,owner80,system2 documentation.

Source/runtime: accepted30e9373310f9e66bb63dd130378f53b86c0cc3f7/8db611d1fc9cd27917d7; final memo fix{source}/cdd3ea4f917ba89765d0. Commits:bd6d2ec reconstructed semantic QA/harness;87c123b readiness closures/protected tools;39b7d5f coverage/capture checkpoint;cfd6740 memo presentation fix; final evidence/report commit follows this report. Fresh git fetch origin main succeeded (task6-final-fetch.log), ref736c819a388e3b973a81c55f53a2a4832d9c1054; merge-base ancestry exit0, no merge.

## Tests and exact evidence

{verification[verification.index('## Source and reports'):verification.index('## Visual and workflow evidence')]}

## Captures, diagnostics and scope

{verification[verification.index('## Visual and workflow evidence'):verification.index('## User review checklist')]}

Final stage6 capture count{h['captures']}, actual images hashed;{len(pairs)} fresh mobile390/desktop1440 major-section pairs,8 inspected contact sheets,{len(responsive)} additional responsive pairs. Canonical sources exact archive restored by controller. Actual memo navigation gap discovered by visual review, not hidden by PNG counts: show(memo) redirected to team in master-ux-runtime-v44. Minimal already-touched master-profile-summary presentation exposes four existing guarded material callbacks. RED original entry fails, GREEN invokes acts/measurements/price/tips, original catalog and Close/Back; existing price asset case also passes. No API/payload/callback/calculation change. Latest auth montage refreshed.

## Affected files

App runtime modified in Task6: {', '.join(runtime)}. Tests amended: {', '.join(testfiles)}. New approved-master-memo.spec.js additionally verifies the actual navigation repair. Full source change list against latest merged main is stage-6/affected-runtime-files.json with exact release SHA256; Task6 only4 UI/generated runtime files versus accepted30e. Durable recovery harness is scripts/qa/(offline-playwright.config.cjs,deny-external-proxy.cjs,run-original-failures.cjs). Evidence/docs/tools reside docs/approved-ui/coverage.json,coverage.md,verification.md,release.md and stage-6/; complete per-file list is Git diff30e..finalcommit, not an inferred screenshot count.

## Recovery chronology and exact commands

Platform cleanup at2026-10-11T13:52Z (15:52 local UTC+2) affected retired59eaed6e4f64 root. We found .scratch-cleaning-5103da217344c33bfe005224fbb39e18-235921-59eaed6e4f64 and atomically moved its remaining tree to current recovery/recovered-workspace-59eaed6e4f64; recursive cleanup had already removed .git/source files. No rm/cleanup/reset command was run by implementer. Isolated main comparison used git archive extraction and node_modules symlink only. Controller restored verified30e full Gitbundle and canonical archive into current73e5936a7e6d; historical2ab0f8e and raw narrow reports were lost and are not reconstructed as fake evidence. Full baseline raw survives SHA recorded in ledger. Dependencies restored via npm ci after offline cache ENOTCACHED. Current reconstructed raw narrow evidence saved by controller at checkpoints; this final report does not claim old2ab recoverable.

Capture commands: node docs/approved-ui/stage-6/capture-final.cjs > ../recovery/task6-captures-final.log2>&1 (batches0–6); targeted BOS_FINAL_BATCH=7/8/9/10 executions wrote memo,owner filter,master list/schedule logs; finalmemo7 used360/390/430/1440 after fix. node stage-6/probe-occlusion.cjs probed12 finance DOM variants and originalPDF; BOS_OCCLUSION_STAGE=3 reran onlyPDF sequentially after manifest concurrency incident. Exact per-batch log path and exit0 is in task6-capture-final-N.log. All captures use synthetic edge/fullStack fixtures and deny nonlocal requests. No production writes/real external actions.

Evidence commands: python3 stage-6/make-failure-ledger.py; python3 stage-6/make-coverage.py (242,allcomplete); python3 stage-6/make-comparisons.py (78 fresh +{len(responsive)} responsive); python3 stage-6/finalize-evidence.py (actual hashes/health/diagnostics); python3 stage-6/verify-protected.py > ../recovery/task6-protected-final.log2>&1 (229 original comparisons1authorized whole-source delta; inverse memo proof;250 final4authorized0unexpected). Commands are run from app with full docs/approved-ui prefix; readable verification.md has exact shell paths and raw report locations.

One final evidence-only scheduling error: schedule capture and occlusion probe briefly overlapped; shared manifest write lost PDF entry while raw probe output/PNG survived. No runtime or test edits during those processes. Reran PDF-only sequentially, checked unique paths/actual hashes/source/build. This is disclosed rather than rewriting lost timings. All baseline and regenerated test runs were fixed source versions; build/test/capture stages for memo fix were sequential.

## Self review, preserved behavior and limits

Verified native handlers, original meaningful payload/status/formula/report upload/deduction/payout/archive assertions; no dropped/renamed baseline failing titles. Screen completion does not imply universal UX or pixel equivalence. Distinct runtime errors404/overflow/action proof remain separate. No new business feature, fake backend, role, demo data, inferred server deployment or unsupported draft/auth behavior. Protected original memo API callbacks/role guard preserved via inverse whole-file check and exact callback test. Original Node/full safe browser executed once; final memo-only runtime is narrowly verified, not full-suite green. Three transient unchanged cases pass but root cause remains unproven; original past-date failure reproduced on main. All76 current ledger closures exact.

Remaining review limits: accepted saved-hours/draft and desktop density minors; initial PDF-nav overlap despite successful scroll/trial-click; no approved master desktop PNG; unavailable hosted browser capability; real devices/auth/installedPWA/push/liveGAS/Hands/Avito/RUserver unverified. User scope private synthetic Preview thenSTOP. No subagents/reviewer/push/PR/publish/mainmerge/deploy/serverchange by implementer. Controller owns separate Preview, final gate and durability. Release.md documents exact allowlist/hash/backup/rollback guards only; production authorization absent.

Final checks: git diff --check, fresh protected proof, exact242 unique complete rows, actual manifest path/hash/source/build validation, SHA-consistent visual pairs and clean commit are required and their outputs recorded before handoff.
''')
print('wrote verification.md release.md task-6-report.md')
