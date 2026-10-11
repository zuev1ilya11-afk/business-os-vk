# Final release pass — 2026-10-11

Base: feat/approved-ui-redesign 4e72142fa1bdb97898f2c566228adef70755c17e. Exact bundle and all chunk SHA256 verified; no previous work overwritten.

User spec: attached final-pass instructions. Existing approved UI and business handlers are authoritative. UI changes only; no production writes, release or merge. Review uses isolated synthetic data.

Plan (already authorized implementation continuation):
1. Compact master day: search/date disclosure, one-line visit filters, concise contact result, original stage/contact actions. Full cards open existing order with independent inner controls.
2. Expose existing permitted finance route as a mobile tab for manager/owner; preserve permission denial and desktop navigation. Add whole-row opening in remaining order lists using existing handlers.
3. Run build/check, Node/server, complete isolated browser suite (exclude live service probes), responsive seven widths and screenshot comparisons. Record exact counts, unresolved coverage and blocking gaps.
4. Independent fresh review, commit/source checkpoint, exact Preview snapshot and isolation tests; publish the tested synthetic Preview with truthful gate status. Production 139.100.237.167 unchanged.

Ruling: use recovered clone at exact feature HEAD; older /workspace/business-os-vk-astra contains unrelated edits and remains untouched.
Ruling: implementation is continuation of explicitly approved design and user-supplied final-pass execution; no repeated planning approval required.
Hosted QA: cloud browser reached the existing private HTTPS Preview sign-in wall. Automatic approval review denied continuing to auth.openai.com without explicit sign-in permission. No bypass or audience change attempted. Finish all unaffected work; hosted interactive gate remains blocked pending authorization.

Core block: 40/40 original focused tests; after reviewer-requested header fix and stronger exact-click/ordered-nav/save-reload assertions, 34/34 final focused tests plus 37/38 earlier (one locator wording corrected). Node 729/729; final full rerun still pending. Production untouched.


## Race fixes after the first complete release regression

The first completed final regression was 739 passed / 8 failed (747 total). It is not a release PASS. A deterministic delayed-enhancement browser regression reproduced a newer finance route being replaced by home. The callback now rechecks the current route and role before refreshing. Independent review also identified competing sibling placement between the smart recommendations and quick-action bar. Both now use card → quick actions → recommendations. The original assignment handler and financial values are unchanged.

The master profile test is updated to follow the canonical profile then open the original login settings. Horizontally scrolled day chips are checked by scrolling, clicking every chip and hit-testing, in addition to page overflow checks. Full regression must run again on build 450d89745b2f499f091b. Hosted browser QA remains blocked by sign-in approval; it has not passed.
