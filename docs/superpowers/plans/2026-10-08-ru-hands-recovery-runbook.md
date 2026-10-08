# RU Hands Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The owner already authorized diagnosis, fixes and publication; do not request the same authorization again.

**Goal:** Restore reliable Hands intake into the active RU release, reconcile missing orders and verify the rest of Business OS without damaging current work.

**Architecture:** Prepare a minimal patch against the exact private handler, validate it with an isolated API, then perform a guarded release with automatic file rollback. Switch the existing provider webhook and reconcile data only after confirming the RU destination. Preserve the live RU database throughout.

**Tech Stack:** Python standard library, Docker, Supabase Edge Runtime, PostgreSQL, existing Hands handler and GitHub Actions.

**Spec:** `docs/BUSINESS-OS-AUDIT-2026-10-08.md`, updated by the server evidence below and the owner's request for one consolidated recovery sequence.

## Global Constraints

- Continue `fix/hands-intake-audit-20261008` and PR #278; refresh remote HEAD before publishing.
- Do not touch LUMI, payroll formulas, roles/auth rules, real reports, assignments or manual edits.
- No destructive migrations, bulk overwrite, real report submission or automatic customer messages.
- Do not deploy the older tracked full Hands handler over the private v11 handler.
- Keep private source, credentials, DB dumps and runtime logs on the server; public reports contain metadata/counts only.
- Do not redirect clients or writes back to the old Supabase database as rollback.
- Direct SSH from this workspace is unavailable; server execution currently needs the owner's console. External provider support remains a separate dependency.

## Review Focus

- A second healthy legacy DB exists: identify the actual REST target through its URI and shared Docker network, then require the active release DB before writes.
- A candidate can exit before a probe: retain private runtime logs before nonce-scoped cleanup; refresh its PID on each attempt.
- A live bundle may differ from disk source: a source guard alone does not justify live valid-token POSTs.
- A new webhook can arrive during reconciliation: use existing uniqueness/concurrency contracts; never replay all old rows blindly.
- An installed phone can retain stale assets: server HTTP success is not evidence of mobile workflow success.

## Evidence at the current checkpoint

| Area | Confirmed | Remaining check |
|---|---|---|
| RU frontend/API route | Fresh GET `/` returned 200; GET `/functions/v1/hands-api` returned 405 | Authenticated requests and actual intake |
| Public readiness URL | `/__bos_ready` returned 404 | Do not use this unexposed path as an activation gate |
| Active release | `bos-release-to2wblxf`; bind-mounted sources/main/bundles | Fresh mount/config checks at each run |
| RU DB | Earlier read-only inspection found the active release DB, order uniqueness and 4 active cron jobs | Actual edge-to-service routing, current snapshots, job success and backup restore |
| Missing intake | One privately identified post-cutover order existed in source and was absent from RU | Full cutover-window comparison and live provider destination |
| Hands patch | Pagination/error regressions tested; exact private sync matches; server bundle creation succeeded | Successful isolated API boot and deployment |
| Candidate startup | Saved log reports `invalid private upstream`; fake loopback BOS origins conflict with gateway validation. Live settings are populated and all routing/container metadata checks matched | Retry with verified credential-free live service origins while keeping network disabled and keys dummy; boot still unconfirmed |
| Application regression | CI run `37782750947` on `885dbdf2b3199e61d76147e2c1f22facda18b604` completed successfully | Prior GAS timeout did not recur in that run; the legacy test origin and RU role/device checks still need review |
| Activation | None performed by these scripts | Activation and rollback tooling still to implement and verify |

## Task 1: One consolidated preparation run

**Files:** `scripts/ru-hands-stage.py`, `tests/ru-hands-stage.test.py`; pinned dependency `scripts/ru-check.py`.

**Interfaces:** `candidate_environment(gateway_text, origins) -> dict[str,str]`; `production_preflight(diag, edge, containers, gateway_text) -> dict`; prepared stage produces private `manifest.json`, source and bundle backups, staged source/helper/bundle.

- [x] Reproduce missing candidate environment and wrong-network alias behavior in tests.
- [x] Supply verified credential-free BOS Auth/REST/Storage origins, dummy JWT/VK keys and dummy Supabase settings; keep `--network none`, resource caps and read-only mounts. The origins pass the existing gateway validator but remain unreachable in the candidate.
- [x] Compare live routing metadata and REST's database container target; report every result without exposing values or applying speculative fixes. This does not prove logical database identity, connectivity or health.
- [x] Preserve the failed candidate log tail privately before cleanup; emit fixed diagnostic categories only.
- [x] Run `PYTHONDONTWRITEBYTECODE=1 python3 tests/ru-hands-stage.test.py`: 10 passed; independent review completed.
- [ ] Publish and verify the pinned download.
- [ ] Owner runs the pinned script once. Expected success: `BOS_HANDS_PREPARED=...` and manifest `activated: false`. Any false/unknown production preflight result remains a release blocker until explained.
- [x] Read the saved error with `--diagnose`: it reports `invalid private upstream`. Correct the candidate origin configuration, without changing the gateway or its validation rules. Later failures automatically print the sanitized saved log before cleanup.
- [ ] Confirm staged API loading/validation. This test proves neither live DB writes nor complete dependency equivalence.

## Task 2: Guarded activation and rollback

**Files to create:** `scripts/ru-hands-activate.py`, `tests/ru-hands-activate.test.py`.

**Interfaces:** input is one private prepared-stage path; consume its exact edge ID, paths and before/after SHA-256 values. Produce a private activation receipt only after verification.

- [ ] Before implementation, verify source/bundle dependency provenance and whether lifecycle's separate live handler needs its own patch. Never overwrite the full private lifecycle handler from the repository without comparison.
- [ ] Add failure tests for stale manifests, changed production files, wrong release paths, failed restart/probe and rollback failure; all must preserve data and retain recoverable files.
- [ ] Recheck target image, mounts, original file hashes, free space and backup readability. Capture original ownership/mode and restore them on rollback.
- [ ] Replace only the reviewed Hands source/helper/bundle using same-filesystem atomic file replacement; restart only the active edge container during a coordinated short API interruption.
- [ ] Check existing frontend and API routes plus the reviewed deployed webhook validation branch. A failed gate restores previous files and restarts the same edge; never restore an old DB snapshot over new work.
- [ ] Publish reviewed activation tooling and provide the exact command only after the preparation result is known.

## Task 3: Switch the existing Hands webhook

**Files:** record non-secret outcome in this runbook; no provider mutation in staging scripts.

**Interfaces:** approved RU webhook origin/path, existing token retained privately, provider support confirmation of a single subscription.

- [ ] Verify trusted HTTPS, current gateway routing, webhook authentication and expected response behavior on the installed handler.
- [ ] Prepare one support request to replace the existing destination with the RU endpoint while retaining the current token; do not create a duplicate subscription. The user previously configured the address through Hands support.
- [ ] Owner sends the prepared request, unless separately authorizing a supported sending channel.
- [ ] Confirm a genuine new incoming event is stored and visible in RU. Confirm repeat delivery does not create a duplicate and that new events no longer land in the old source. Do not close the old source prematurely.

## Task 4: Reconcile missing orders safely

**Files to create after schema/importer review:** `scripts/ru-hands-reconcile.py`, `tests/ru-hands-reconcile.test.py`.

**Interfaces:** private source/upstream/target snapshots bounded by the cutover window; output a dry-run manifest keyed by source/account/external ID, plus counts safe to share.

- [ ] Create a consistent target DB backup and verify its restore in an isolated DB before writing recovered records. Preserve current Storage and configuration; do not print credentials.
- [ ] Compare source records created or updated after cutover with upstream and RU. Separate absent orders from existing manually changed records and conflicting deliveries.
- [ ] Test duplicate/repeated input, concurrent arrival, protected manual changes, partial failure and notification suppression using fixtures before applying anything.
- [ ] Restore only reviewed absent records through the target's existing import rules. Confirm any DB triggers/notification side effects before application; do not run an indiscriminate full sync.
- [ ] Repeat the same reconciliation and require zero additional inserts; compare counts and inspect the known missing order privately.

## Task 5: Verify remaining application functions in one pass

**Files:** maintain the evidence matrix in `docs/BUSINESS-OS-AUDIT-2026-10-08.md`; use existing tests before adding new ones.

**Interfaces:** exact deployed revision, role-specific test accounts and disposable test order/files; no real report or payment changes.

- [ ] Check exact-commit CI once: build, server tests, Deno/TypeScript, SQL contract and browser suite. Investigate only concrete failures; do not repeat the full audit on every console result.
- [ ] Resolve CI run `37780918442` for commit `a6a1eb51b1bd1f5dc50568c67b19e76905f2b886`: `tests/gas-bridge-health.spec.js` still calls the old Supabase origin and timed out at 30 seconds on both attempts. Inspect the RU bridge and archive configuration before changing its test target. Do not skip this failure or assume Hands changes caused it. The health handler issues a synthetic signed archive request; do not substitute a real order/report.
- [ ] Owner/manager/dispatcher/master: verify login, role boundaries, list visibility, profile return and editing permissions.
- [ ] On a disposable order, verify contact/date/time, assignment, workflow progress, attachments, report save/review and retry behavior. Keep the protected real report/order untouched.
- [ ] Verify payroll display/calculation invariants, period filters and expenses without modifying historical finance records.
- [ ] Verify Storage read/upload, successful cron executions and queue progress; inspect Avito/push configuration without sending customer messages or notifications.
- [ ] On the owner's phone, verify installed PWA refresh and login over Wi-Fi and mobile data. Record each untested device/provider capability explicitly.
- [ ] Update the audit with deployed commit, backups/rollback location, restored counts and remaining blockers. Declare intake restored only after a real RU delivery and clean reconciliation.

## Owner's console sequence

1. Run the single pinned preparation script supplied in chat and share its final result.
2. Run the guarded activation command only once it is published and tied to that prepared stage.
3. Send the prepared Hands support request after endpoint verification.
4. Run the reviewed reconciliation command after its dry-run and backup checks.
5. Perform the short phone check; all other code, review and publication work stays with the agent.

Commands for steps 2–4 are intentionally not fabricated: their inputs depend on step 1, provider confirmation and the reconciliation diff.
