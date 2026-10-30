# Stage 0: isolated staging preparation

> **For agentic workers:** Use superpowers:executing-plans. The user authorized execution of the available safe work, without production changes. Continue around blockers.

**Goal:** Make the available preparation and local rehearsals reviewable; do not claim a deployed staging system.

**Architecture:** Reuse the existing Python frontend release core, synthetic SQL preview adapter, Edge test handlers and browser suite. Add a read-only inventory and fail-closed validator for an explicitly supplied rendered staging Compose plan. Do not invent the missing live schema or container versions.

**Tech Stack:** Python standard library, existing Node/Playwright/PGlite lockfile.

**Spec:** `docs/staging/SPEC.txt`

## Global constraints

- No production changes, restart, migration, merge, outbound messages or integration calls.
- Base `97c9f7af3065d24f1e1da5067ef622410501123b` preserves report recovery and receipt date.
- No full database schema, Docker/Postgres runtime or confirmed server access is available here.
- Fixture tests and cold backup of the partial PGlite fixture are not real PostgreSQL/Auth/Storage acceptance.

## Review focus

- Shared paths, symlinks, external volumes and namespace escapes must be rejected.
- Unresolved Compose input or absent production inventory must fail closed.
- Read-only inventory must never expose env values, commands, labels or secrets.
- A failed frontend release must restore its bytes without restoring business data.
- Browser tests must block outbound traffic even when a UI route is not mocked.

### Task 1: read-only inventory and staging gate

Files: `deploy/staging/inventory.py`, `guard.py`, `test_staging.py`.
Interfaces: `inventory.summarize(containers, networks)` produces allowlisted metadata; `guard.validate(plan, inventory, root)` raises `Stop` on unsafe input.

- [x] Write tests for external network, production bind path, symlink, privileged service, production origin, duplicate ports, unresolved secrets and sanitized inventory.
- [x] Run `python3 -m unittest discover -s deploy/staging -p test_staging.py -v`; verify RED.
- [x] Implement read-only checks. No docker mutations or arbitrary subprocess command input.
- [x] Run the same command; verify GREEN.

### Task 2: isolated local rehearsals

Files: `deploy/staging/rehearse.py`, `rehearse-data.cjs`, tests in the same directory.
Interfaces: CLI requires `--environment staging`; exclusive newly created scratch target. Reuse `scripts/ru-master-home-release.py` install/rollback only, never its production discovery/main.

- [x] Test dry-run creates nothing; existing/symlinked target rejected; A→B→failure→A restores frontend and retains a simulated post-backup business-data change.
- [x] Rehearse cold backup/restore of the existing PGlite fixture, synthetic file and configuration into a separate empty target; verify SQL records and file hashes after reopening.
- [x] Run existing release tests, build/check and browser scenarios for all roles, reports, received date and finance. Record exact counts and limitations.

### Task 3: handoff and gate status

Files: `docs/staging/README.md`, `AUDIT.md`, `VERIFICATION.md`.

- [x] Document source/server drift, outgoing integrations and isolation matrix.
- [x] Provide short read-only server commands; no generic production apply command with guessed paths.
- [x] Record server prerequisites and distinct application rollback/data recovery procedures.
- [x] Review the final diff and commit on the feature branch; no merge/deploy.

## Execution notes

Pre-flight: all tasks share the staging-only safety boundary and reuse existing tools. No new deployment system or fabricated complete schema.

Ruling: server deployment and full database restore are blocked on actual inventory/schema/runtime. Local tests proceed as explicitly requested, with this limit carried into the result.

Task 1: complete — structural gate and read-only inventory; 23 Python safety tests.
Task 2: complete for available LOCAL scope — 5 Python rehearsal tests, PGlite cold-restore test, existing release tests 12+11, offline browser scenarios 87+1, four-width preview. Server acceptance remains blocked.
Task 3: complete — audit, isolation matrix, verification results and short server diagnostics; no production commands executed.

Final review: independent read-only reviewer; two Important findings reproduced RED and fixed GREEN (unknown host-access service options; existing Compose project/implicit container name collision). Final Python suite 28/28.
Final: Ruling: live isolation/schema/RLS/Auth/Storage cannot be judged without server access — preserve the closed launch gate and report them unverified; cost of treating local fixtures as acceptance would be unsafe deployment.
Final: Ruling: the general UI suite includes a live health test; auto-review blocked continuing that run — use existing offline config with both live health suites excluded; no claim of a complete 895-test run.
Final: minor (deferred): ordinary manual preview cannot guarantee blocking top-level browser navigation; documented, automated browser tests use a deny proxy. Complete browser-environment isolation remains a server acceptance prerequisite.
Final: Ruling: hardcoded clipboard permission origin caused one alternate-port fixture failure — rerun on its specified 4173 origin, passed; no unrelated product/test refactor.
