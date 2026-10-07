# Final RU release implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline; one final independent review.

**Goal:** Supply one server command that obtains trusted IP HTTPS before downtime, then captures current source data/files and opens the RU application, with source writes disabled at cutover.

**Architecture:** Reuse successful immutable Edge bundles and service image IDs, but restore a fresh source dump in a new release directory. Caddy gates public API until data, signed attachment links and local login work. Persist a source-thaw script before freezing; automatically thaw only before target activation is attempted.

**Tech Stack:** Python stdlib, Docker, PostgreSQL17.11, existing service pins, Caddy2.11.7, static existing frontend.

**Spec:** User authorized completion and a write pause. PLAN.md records proven restore/core/Edge compatibility; original snapshots are stale (381 source files vs374 tested).

## Global Constraints
- Preserve all previous directories/containers; no reuse of stale DB data as production.
- No source secret values in argv/chat/git/log output. Hidden terminal prompts for source DB password and Storage server key.
- Only postgres database readonly setting, four cron flags and existing enabled runtime flags may be changed on source; persist their exact previous state. Terminate ordinary client connections so new settings take effect; do not kill superuser/platform processes.
- Never automatically thaw source after target public-write activation begins.
- Keep cron disabled on target until source is frozen and public target is ready. Keep one-off/test Edge functions unexposed.
- Fresh dumps/Storage checks are final synchronization, not another compatibility rehearsal. All live execution remains on user's server.
- Frontend copy is from exact current main7e3fb7198a45e1d2c2ab3ca7d6439c73ff154ae8, rebuilt with existing generator; replace old fallback routes with one target; don't change business logic/payroll/auth.

## Review Focus
- Failure between source freeze and public opening must restore source or print a definite manual recovery command; crash recovery state must persist.
- Old signed Storage links must point to verified existing objects and be signed by target; no blanket credential or unrelated URL replacement.
- Empty/partial/failed trial reports or changed bundle/image identities must not be promoted.
- Public gateway must hide private files, block one-off routes and retain per-function JWT; no implicit static fallback for API errors.
- Browser Request bodies/auth headers and no-replay behavior must survive transport conversion.

### Task 1: Release files and gateway
**Files:** release_files.py, release_network.js, release_router.mjs, test_release_files.py, test_release_network.mjs, test_release_router.mjs.
**Interfaces:** validate_trial(path)->report/routes; render_caddy(origin,service_key,active)->str; prepare_frontend(repo,destination,origin,node_runner); transform_attachment(value,signer)->value; production router handle(req,config).
- [ ] Tests first: incomplete proof/bundle rejection, Caddy maintenance and API/static separation, exact attachment paths/JSON and unknown-object refusal, Request body and no retry, blocked one-off and JWT before worker.
- [ ] Run tests; expect missing implementation (RED). Implement, run targeted tests GREEN; validate Caddy with actual2.11.7 binary and frontend build with exact main.
- [ ] Commit.

### Task 2: Source freeze, capture and orchestration
**Files:** release_source.py, finish_release.py, test_release_source.py, test_finish_release.py, release README and manifest.
**Interfaces:** Source.sql(query)->bytes; Source.freeze()->state; Source.thaw(state); capture(stage)->backup; run_release(args)->report. All phases use private stage, immutable images, and source recovery state.
- [ ] Tests first: exact prior state recovery, failure before/after activation boundary, dump failures and URL/source guards, target SQL readonly/isolation gating.
- [ ] Run tests RED; implement preflight/HTTPS before freeze, fresh dump/roles/Vault, restore, final file sync, attachment migration, services, login probe, controlled activation and operational stop/status/recovery commands.
- [ ] Run Python/Node suite and syntax/checksums GREEN. One fresh review; fix important issues in one pass, then publish immutable tooling commit and one server invocation. No live deployment claim until server marker.
