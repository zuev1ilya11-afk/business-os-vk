# Hands intake audit and bounded repair

> Execution: superpowers:executing-plans, inline with one final independent review.

**Goal:** Diagnose post-migration missing Hands orders and repair proven import defects without replacing private production handlers.

**Architecture:** Read-only evidence first. Keep existing import rules, endpoints, roles and page limits. Share only page traversal/error accounting between the two tracked import endpoints and a guarded patch of the observed live v11 sync routine.

**Tech Stack:** Existing Node tests, TypeScript Edge handlers, Playwright, PostgreSQL read-only queries.

**Spec:** User attachment `Вставленный текст(7).txt`, full audit and fixes. Production order 1696 stays read-only. No customer messages or external report sends.

## Global Constraints
- No payroll, auth, roles, schema or business-rule changes.
- No live handler replacement from the outdated repository copy.
- No production restore/deployment until the RU DB, backup and actual handler sources can be verified.
- Never claim source-cloud observations prove the target DB's state.

## Review Focus
- Server-enforced page sizes must not truncate the list.
- A malformed success payload must not masquerade as an empty source.
- A failed row must not prevent later valid rows being attempted or claim full success.
- A bounded run with pages remaining must report incompleteness.
- Live patch must preserve webhook/auth/private configuration byte for byte.

### Task 1: Diagnose and reproduce
- [x] Record current main, public RU build and old-source intake after cutover.
- [x] Run current server baseline and start complete browser baseline.
- [x] Reproduce pagination, malformed-envelope and batch-failure defects with isolated fixtures.

### Task 2: Minimal import repair
Files: `_shared/hands-sync.ts`, `hands-api/index.ts`, `order-lifecycle-api/index.ts`, `scripts/patch-live-hands-sync.cjs`, `tests/hands-intake-sync.test.cjs`, `tests/fixtures/hands-v11-sync.ts`, `tests/helpers/edge.cjs`.
Interface: `syncHandsPages(body, status, fetchPage, importRow)` returns existing `{seen,created,updated,pages,status}` only on a complete successful run; throws safe explicit errors otherwise.
- [x] Tests RED: two pages with server cap, failure in first row, malformed envelope, page bound, repeated import.
- [x] Implement shared bounded traversal, integrate existing import functions, and exact-source live patch.
- [ ] Targeted tests GREEN, required build/server/browser checks, review, commit and PR.

### Task 3: Audit report and production boundary
- [x] Record function/role/scenario/evidence/version/status matrix and configuration dependencies.
- [x] Record source intake incident, restore candidate and target-access blocker; no speculative data recovery.
- [ ] Publish reviewed code through the existing repo; report deploy/CI status honestly.

## Evidence / decisions
- Main: 8a1fb97057286a77dc4903297a280eb5d8923e5b. RU public BUILD_ID: d1bd2bcf02ef88e9cb6c.
- Source Hands v11 read via connected Supabase. Source cron all four inactive; no inbound import cron among them.
- Source DB default read-only is on but a Hands order and webhook receipt were persisted after cutover. Source receipt timestamp: 2026-10-08T10:45:44Z. External ID retained privately in incident notes, not public PR.
- Ruling: production recovery remains blocked by absence of authenticated access to the RU database/runtime, not by lack of user authorization. A wrong target assumption risks duplicates or overwriting manual work.
- Baseline: build check passes; 696/696 server tests. Browser baseline running.

Final gate: 712 server tests passed after review corrections. Public GitHub push blocked by automatic review despite ownership verification; user confirmation is required. Production routing/recovery remains blocked by RU access. Do not mark remaining deployment steps completed.

Follow-up: user explicitly approved publishing the prepared branch and creating a PR on 2026-10-08. GitHub publication proceeds through the authenticated connector; the local git remote has no write credential. Production access remains unavailable.
