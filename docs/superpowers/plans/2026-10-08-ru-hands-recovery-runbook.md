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
| Missing intake | Post-cutover orders exist in the old source. The initial RU incident lookup omitted the canonical `hands:` prefix, so its zero result does not prove absence | Corrected RU lookup, complete comparison and live provider destination |
| Hands patch | Pagination/error regressions tested; exact private sync matches; bundle creation, isolated validation and guarded activation succeeded | Actual provider intake and reconciliation |
| Candidate startup | Owner's 16:41 screenshot confirms `BOS_HANDS_PREPARED`; all routing/container metadata checks passed; no production activation | Recheck the same release at activation |
| Application regression | CI run `37795943851` on token rotation commit `8c2e137d3b85606867c7496879df21496aa5374c` completed successfully | Legacy GAS test origin and actual RU roles/devices |
| Activation | Owner's 17:11 screenshot confirms `BOS_HANDS_ACTIVATED` and successful HTTPS/webhook validation | Genuine delivery and reconciliation |
| Webhook token | Owner's 17:57 screenshot confirms `BOS_HANDS_WEBHOOK_TOKEN_UPDATED`, new-token acceptance and old-token rejection | Genuine provider event stored in RU |

## Task 1: One consolidated preparation run

**Files:** `scripts/ru-hands-stage.py`, `tests/ru-hands-stage.test.py`; pinned dependency `scripts/ru-check.py`.

**Interfaces:** `candidate_environment(gateway_text, origins) -> dict[str,str]`; `production_preflight(diag, edge, containers, gateway_text) -> dict`; prepared stage produces private `manifest.json`, source and bundle backups, staged source/helper/bundle.

- [x] Reproduce missing candidate environment and wrong-network alias behavior in tests.
- [x] Supply verified credential-free BOS Auth/REST/Storage origins, dummy JWT/VK keys and dummy Supabase settings; keep `--network none`, resource caps and read-only mounts. The origins pass the existing gateway validator but remain unreachable in the candidate.
- [x] Compare live routing metadata and REST's database container target; report every result without exposing values or applying speculative fixes. This does not prove logical database identity, connectivity or health.
- [x] Preserve the failed candidate log tail privately before cleanup; emit fixed diagnostic categories only.
- [x] Run `PYTHONDONTWRITEBYTECODE=1 python3 tests/ru-hands-stage.test.py`: 16 passed; independent review completed.
- [x] Publish and verify the pinned download.
- [x] Owner runs the pinned script once. Success confirmed: `BOS_HANDS_PREPARED=...`; all production preflight metadata checks passed and production remained untouched.
- [x] Read the saved error with `--diagnose`: it reports `invalid private upstream`. Correct the candidate origin configuration, without changing the gateway or its validation rules. Later failures automatically print the sanitized saved log before cleanup.
- [x] Confirm staged API loading/validation. This test proves neither live DB writes nor complete dependency equivalence.

## Task 2: Guarded activation and rollback

**Files to create:** `scripts/ru-hands-activate.py`, `tests/ru-hands-activate.test.py`.

**Interfaces:** input is one private prepared-stage path; consume its exact edge ID, paths and before/after SHA-256 values. Produce a private activation receipt only after verification.

- [x] Fresh source export still contains private v11 and its local `hands-details.ts` dependency; activation matches both full-source hashes. The runtime image is immutable. The floating npm dependency needs the runtime reproducibility gate below; source preservation alone is not dependency equivalence. The separate lifecycle handler remains unchanged and is still a target-review follow-up, not part of this Hands-only activation.
- [x] Add failure tests for changed production files, unreviewed staged changes, failed restart/probe, interrupted/partial swap, concurrent change during rollback and rollback failure; all preserve data and retain recoverable files.
- [x] Implement checks for image, mounts, original hashes, free space, routing, backups, ownership and modes. Lock before selection; persist and fsync backups/journal before replacement. Reject ambiguous prepared stages and unrelated recovery paths.
- [x] Implement same-filesystem atomic replacement in helper → source → bundle order; restart only the exact edge after verifying it has not been superseded. Bundle replacement itself can affect a newly loaded worker before the restart.
- [x] Implement trusted public HTTPS GET checks and the reviewed, installed handler's token-authenticated missing-delivery branch (empty body, no delivery header; returns before DB access). Failed verification restores previous files and restarts the same edge. No DB snapshot restoration or imports.
- [x] Publish reviewed activation tooling and verify its download byte for byte.
- [x] Owner runs activation: 17:11 screenshot confirms `BOS_HANDS_ACTIVATED=...` and successful HTTPS/webhook validation. The script reached this marker only after the dependency gate, guarded swaps, restart and postchecks.

### Dependency and recovery gates

Before replacing live files, the activation command rebuilds the original source with the exact image, path and options and requires its bundle to match the original byte for byte. It then disconnects that compiler container's only network, verifies that only loopback remains, and builds the patch using the same resolver cache. This second bundle must match the already tested prepared artifact. `DEPENDENCY_PROOF_UNKNOWN` stops before production changes; a mismatch can mean nondeterminism or different original build options, not necessarily a dependency upgrade. The official runtime's managed-NPM unbundle output is insufficient to prove npm equality and is not used as a false success gate.

The private `activation.json` records `installing`, `verifying`, `activated`, `rolling_back`, `rolled_back` or `rollback_failed`. A rerun detects an interrupted attempt and performs guarded rollback rather than starting a new replacement. It refuses to overwrite unrelated changes or restart a superseded release. A rollback failure retains originals and the journal for diagnosis. No script can automatically recover during host power loss; recovery runs on the next invocation.

Local verification: 24 activation tests, 16 preparation tests and 712 server tests passed. Exact activation commit CI passed. The owner's success marker confirms that the server passed the activation gates; no recovery import or provider change was performed by the script.

## Task 3: Switch the existing Hands webhook

**Files:** record non-secret outcome in this runbook; no provider mutation in staging scripts.

**Interfaces:** approved RU webhook origin/path, replacement token entered privately on the server, provider support confirmation of a single subscription.

- [x] Activation verified trusted HTTPS, current gateway routing and the installed handler's valid-token missing-delivery response. A later invalid-token probe from the agent workspace was inconclusive due to a connection error, not counted as a passed negative-authentication test.
- [x] Prepare the support request below to replace the existing destination while retaining the current token; do not create a duplicate subscription. The user previously configured the address through Hands support.
- [x] Owner reported replacement at 17:25 and confirmed at 17:32 that Hands issued a new **webhook** token. The 17:57 console screenshot confirms installation of the new token and rejection of the old token. Genuine provider delivery is a separate pending check.
- [ ] Confirm a genuine new incoming event is stored and visible in RU. Confirm repeat delivery does not create a duplicate and that new events no longer land in the old source. Do not close the old source prematurely.

Support request (owner sends through their existing Hands support conversation):

> Здравствуйте! Мы перенесли приложение на новый сервер. Просьба изменить адрес нашей действующей webhook-подписки на `https://139.100.237.167/functions/v1/hands-api`, сохранив текущий параметр `?token=...` и его значение из существующей настройки. События и заголовки доставки оставить прежними. Замените адрес в текущей подписке, не создавая вторую. Подтвердите, пожалуйста, переключение и время изменения.

The screenshot field `WEBHOOK_TOKEN_SHA256` is a fingerprint, not the webhook credential. The actual token is not included in this request or public documentation. Provider support already holds the existing subscription value; there is no need to paste it into this chat.

17:29 checkpoint: old source receipt count 150, latest `2026-10-08T13:33:10.657642Z`, none after the owner's replacement report. New RU intake remains unverified. The corrected read-only diagnostic must recognize canonical `hands:<id>` as well as legacy numeric IDs; do not use the earlier zero match as a recovery authorization or proof of absence.

### New provider-issued webhook token

`scripts/ru-hands-token.py` requests the new token via hidden terminal input only; do not put the value in chat, shell commands, command arguments or environment variables. It changes only the `WEBHOOK_TOKEN` literal in the exact activated private handler and its rebuilt bundle. `HANDS_API_KEY`, other credentials, DB records and provider configuration are not changed.

The command takes the same activation lock, checks the successful deployment receipt, verifies all other source/helper/gateway/bundle files, and privately backs up the current source/bundle. It reproduces the current bundle first, then compiles the token change offline using the same resolver cache. Before activation an isolated candidate must return `400 MISSING_DELIVERY` for the new token and `404 NOT_FOUND` for the old token on the same route. Source and bundle hashes are checked before and after testing and against the transaction journal.

Only the source and Hands bundle are atomically replaced. The exact active edge is restarted, then public HTTPS checks verify the new token and rejection of the previous token. Rollback restores only previous local files/token; it does not restore provider delivery if Hands already uses the new value. Private recovery state is retained under the original stage's `webhook-token-rotation` directory. A rerun recovers interrupted replacement before requesting any token, or verifies an already successful rotation. Another future rotation requires a fresh reviewed baseline; this command is deliberately tied to this activation.

- [x] Implement token-only rotation and regression coverage, including hidden-input failure, token scope, URL encoding, tested-artifact preservation and recovery allowlist.
- [x] Publish reviewed rotation command at `8c2e137d3b85606867c7496879df21496aa5374c` and verify its download byte for byte. CI run `37795943851` completed successfully.
- [x] Owner enters the new webhook token privately in the server console. The 17:57 screenshot shows `BOS_HANDS_WEBHOOK_TOKEN_UPDATED` and confirms new-token acceptance and old-token rejection. The command imported no orders and changed no provider settings.
- [ ] Verify genuine provider delivery and the corrected target incident lookup before recovering any order.

At 18:00 Moscow, a fresh read-only old-source check still found 118 orders, 110 from Hands and 150 receipts, latest `2026-10-08T13:33:10.657642Z`; none arrived after the owner's switch report. This does not establish RU receipt. Next, run the published corrected `scripts/ru-check.py` on the RU host and inspect the target counts, latest receipt and exact incident match before reconciliation.

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

- [x] Check exact activation commit CI: run `37789617299` completed successfully. Actual RU/device checks below remain separate from repository CI.
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
