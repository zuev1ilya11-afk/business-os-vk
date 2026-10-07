# Isolated BOS Edge Trial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** One server invocation assembles35 backed-up Edge Functions and proves synthetic BOS password login/refresh/bootstrap on a disposable offline database clone.

**Architecture:** Extend the existing verified service trial with an optional Edge stage. Assemble each function in its own source tree, bundle with pinned Edge Runtime in credential-free build containers, then serve immutable eszips inside the database's network-none namespace through a loopback gateway. Preserve per-function JWT settings; invoke only audited password-session-api and mini-app-api business handlers.

**Tech Stack:** Python3 stdlib, Docker, supabase/edge-runtime:v1.76.2, Node24 in the verified Storage image, PostgreSQL17.11.

**Spec:** PLAN.md (migration authorization, isolation and successful core-service trial); this header specifies the next bounded stage.

## Global Constraints

- Original candidate bos-restore-trial-avcpcsf0 remains stopped; no cloud/main writes, published ports, cron enabling, merge or cutover.
- Consume the35-function/57-file private snapshot with exact hashes and captured metadata; retain separate deployed versions of shared source files.
- Use only receipt-verified five keys from runtime-secrets-4rovqvfz; real keys never enter build containers, command arguments, reports or chat.
- Build downloads dependencies without executing application modules; runtime has no external network. Record actual image identity and bundle hashes; original broad dependency ranges remain a documented reproducibility limit.
- Synthetic fixture is a random new staff ID/login/external ID in the disposable clone only. Clean its staff/rate-limit rows and compare staff/orders/rate-limit digests before and after.
- Success requires bundle35, meaningful auth/API proofs, cleanup and confirmed stop of every created container. Browser UI, external integrations, HTTPS, realtime and cutover remain unverified.

## Review Focus

- Absolute source metadata and shared relative imports must not escape or mix trees; reject traversal, symlinks and collisions.
- A stale/failed secret receipt or changed snapshot must fail before runtime starts.
- Build container must have no DB/config/secret mounts and must stop even on timeout.
- JWT-required routes must reject absent/invalid/expired tokens before creating a worker; do not weaken other functions' source setting.
- Probe failure must still remove only its own fixture and stop processes; no success on cleanup failure or changed original rows.

### Task 1: Verified function assembly

**Files:** Create edge_trial_files.py, edge_source_baseline.json, test_edge_trial_files.py.

**Interfaces:** read_snapshot(root:Path,baseline:dict)->list; assemble(functions:list,destination:Path)->dict routes; read_verified_secrets(root:Path)->dict. Route entries carry slug, entrypoint, import_map, verify_jwt and source hashes.

- [x] Write failing tests for nested project imports/separate source trees, traversal/absolute mismatch/collision/symlink refusal, changed checksum/inventory rejection and receipt-to-secret-file binding.
- [x] Run python3 -m unittest test_edge_trial_files; expect missing module, then assertion failures until implemented.
- [x] Implement the interfaces using the existing backup format, inventory fingerprint and secret-file reader. Normalize only the exact function metadata source prefix; relative paths must have no dot/dot-dot components. Find a single valid snapshot automatically or fail closed.
- [x] Run python3 -m unittest test_edge_trial_files; expect all passing. Commit.

### Task 2: Offline runtime, login probe and integration

**Files:** Create edge_trial.py, edge_router.mjs, edge_probe.mjs, test_edge_trial.py, test_edge_router.mjs, edge_trial.SHA256SUMS; modify rehearse_services.py and PLAN.md.

**Interfaces:** prepare_edge(runner,snapshot,secrets_dir)->dict stage configuration (called before DB clone); run_edge(runner,prepared,db,storage_id,credentials)->dict proof. Existing Runner owns every container and cleanup. Router exports JWT/path policy for Node tests; Deno starts listener only under import.meta.main.

- [x] Write failing Python lifecycle tests for credential-free builder args, runtime namespace/mount isolation and fixture cleanup on probe failure; write Node router tests for missing/bad/expired/valid HS256 and false verify_jwt routes, allowlist/path refusal.
- [x] Run python3 -m unittest test_edge_trial and node --test test_edge_router.mjs; expect absent APIs.
- [x] Implement compile-only eszip generation and offline router with per-function JWT checks, loopback prefix gateway and synthetic login probe. Read-only shared source trees, use exact audited main-source hashes for the two invoked functions. Fail on fixture collision; scoped cleanup plus pre/post row digests; print only phase/status/bools/counts.
- [x] Extend existing service trial via --edge-secrets; auto-discover the one verified function snapshot, prepare before copying DB, invoke after core probes and before existing postchecks. Report distinguishes core-only vs Edge success, and no actual user session/token output.
- [x] Run python3 -m unittest and node --test test_service_probe.mjs test_edge_router.mjs; expect all pass; compile Python/Node syntax and checksum manifests, git diff --check. Commit.
- [x] One fresh whole-stage reviewer; fix Important/Critical with RED→GREEN and green suite. Publish the authorized tooling branch with immutable commit/hash verification; deliver one server command. Actual Docker build/offline dependency completeness/SQL and BOS runtime behavior remain server gates.
