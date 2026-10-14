# Master help implementation plan

> Execute inline with superpowers:executing-plans. The owner supplied and approved the spec; no further design approval is required.

**Goal:** Illustrated, concise learning inside the current master cabinet, including client communication and FAQ.
**Architecture:** A small startup entry adds help buttons and lazily loads a standalone dialog, data and stylesheet. The dialog never replaces modalRoot. Existing memo rendering supplies old documents into a separate host. Lessons use captured actual UI with synthetic fixtures.
**Tech Stack:** Existing classic JavaScript, CSS, Playwright, Node test harness.
**Spec:** ../specs/2026-10-14-master-help.txt

## Global constraints
- No backend, API, auth, roles, finance, workflow or production configuration changes.
- No main merge or Russian production deployment. Separate branch and private read-only Preview only.
- 10 lessons, 6 communication cards, 12 FAQ, 5 problems. No real customer data.
- Sizes 320/390/768/1440 CSS px; Chromium and WebKit if available.
- Preserve drafts, file input identity, ongoing uploads, order identity, focus and scroll.

## Review focus
- Background form replacement or accidental submit on help clicks.
- Loading/copy/image failures must remain recoverable and honest.
- Long content and enlarged text must leave all actions reachable.
- Keyboard/Escape must affect help only; preserve underlying modal.
- Existing documents and role screens must remain available.

## Task 1 — viewer and safe integration
Files: master-help-entry.js, master-help.js, master-help.css, master-memo-runtime-v21.js, scripts/startup-assets.json; tests/master-help.spec.js.
Interface: window.openMasterHelp(topic='home'); topics are lesson IDs, home, talk, faq, problems, materials. Only structured content and static local assets. Existing openMasterMemoItem('tips') delegates to help. Other categories retain handlers.
- [x] Write regression that opens real contact/agreement/report forms, opens help, navigates, closes, and asserts DOM identity, draft, date/time, files and zero business writes.
- [x] Run it failing because help is missing.
- [x] Implement lazy entry, standalone accessible dialog, back/next/steps/zoom, search/categories, copy status and material loading.
- [x] Run viewer tests and existing memo/schedule regressions.

## Task 2 — verified content and illustrations
Files: master-help-data.js; master-help-images/master-help-*.png; scripts/qa/capture-master-help.cjs; tests/master-help-content.test.cjs.
Interface: window.BOS_MASTER_HELP_DATA={lessons,talk,faq,problems,managerTemplate}; each lesson step has title, text, image, alt and optional detail/warning/branches.
- [x] Add coverage checks for counts, existing asset files, per-lesson navigation and all FAQ/search/copy flows.
- [x] Run missing-content failure.
- [x] Map exact UI labels and capture cropped highlights from actual app on synthetic fixtures. Keep source text separate from imagery.
- [x] Exercise all lessons and image loading; capture representative UI at four sizes.

## Task 3 — verification, review, PR and private Preview
Files: docs/master-help/README.md; generated build outputs; isolated existing Preview source.
- [x] Run normal build/check, diff whitespace and focused tests. Mandatory complete CI runs on PR, without expanding into a fresh audit.
- [x] Review all changes and perform one independent branch review, fix meaningful issues.
- [ ] Commit and push feature branch; create PR to main, no merge.
- [ ] Copy exact committed app into separate private Preview path using the existing synthetic read-only adapter. Preserve other previews.
- [ ] Save/deploy the private Site and record returned URL, source SHA, checks and limits.

## Execution ledger
- Base: c9b0c23d4b67810f93bb9bc136e44c57c490fa25. Prior dispatch changes preserved in their separate worktree.
- Owner authorizes implementation and Preview directly; plan review is not a new gate.

- Red observed before viewer/content implementation. Final targeted Chromium run:32 passed (38.1s); Node:5 passed; build:check and diff check pass. Memo timeout, 3 image capture phases and UI evidence capture pass.
- WebKit unavailable; no real-device or production tests claimed.
- Independent read-only review: no Critical/Important/Minor corrections required. Reviewer separately checked initial-home Back guard, agreement Back sequence and320×520 enlarged-text layout. WebKit/devices/hosted access/full CI deferred to their respective evidence.
