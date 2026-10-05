# Master home simplification implementation plan

**Goal:** Implement the approved master home design on cf7645dc, without changing payroll, backend, statuses or permissions.
**Architecture:** v127 owns the single active/nearest order and remaining queue. v110 supplies scoped claims and linkage to v127; its legacy rendering remains a fallback. v128 owns collapsible day totals. v179 explains existing agreement gating. v129 removes only the home salary summary.
**Tech Stack:** Existing vanilla JavaScript modules, Playwright local fixtures, Node tests.
**Spec:** User-approved design and execution constraints supplied with this task.

## Global constraints
No live customer data or requests. No deploy/merge/publication. Keep nextOrder selection unchanged. Deduplicate orders by id, claims by claim id; preserve every reason and orphan claim. Keep attention unlimited, ordinary remainder initially three. Keep salary formulas and salary tab untouched.

## Review focus
- Rejected reports retaining upload attributes must remain actionable.
- Multiple claims, completed linked orders and orphan claim ids remain visible.
- Preview, saving and uncertain state explain actual gating before contact reasons.
- Re-render and reload retain correct totals, hints and no duplicates.
- 360/390/430px layouts remain usable.

## Execution
- [x] RED: add behavioral home/claim/summary/contact tests, run with installed Chromium.
- [x] GREEN: modify v127, v110, v81 integration, v128, v129 cleanup, v179 hints/signature; no new patch layer.
- [x] Update existing assertions that explicitly expect the superseded layout.
- [x] Run targeted tests, full npm test, review diff, standard build and build:check.
- [x] Record exact verification results and salary preservation evidence for release review.

## Result

Implemented and independently reviewed. Fresh server result: 670 passed. Full UI: 579 passed, 1 existing opt-in archive health skipped, 1 external GAS health failed because the environment proxy returned Domain forbidden / HTTP 403 on CONNECT. No local UI failures. Standard build and build:check pass; build ID 2dfde5fcfdf23a68fdbf. No publication, merge or deployment performed.
