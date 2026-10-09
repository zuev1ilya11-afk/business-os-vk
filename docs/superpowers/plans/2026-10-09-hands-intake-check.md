# Hands intake evidence and safe reconciliation preparation

**Goal:** Identify the remaining RU intake break without repeating yesterday's activation or overwriting orders.

**Architecture:** A standalone, read-only host diagnostic reuses the SHA-256-pinned `ru-check.py` from PR #278. It resolves the actual release REST database, inspects bounded runtime error signals, reads the existing Hands ACTIVE feed and compares canonical external IDs. It prints counts only and leaves a private candidate-ID manifest on the server. It cannot import, deploy, restart, schedule or rotate credentials.

**Tech stack:** Python standard library, existing Docker/PostgreSQL and existing Hands API.

**Spec:** User's 2026-10-09 incident request; prior evidence in PR #278. Current main `a639db4dea71e605446c166ec96ca5af8abacc1a`.

## Constraints and evidence

- No payroll/auth/roles/schema/UI/report changes. No full application audit.
- Old-source fresh check: 110 Hands orders, 150 receipts, last receipt 2026-10-08T13:33:10.657642Z; none since yesterday's 18:10 Moscow checkpoint.
- RU trusted HTTPS works; handler GET 405, unauthenticated POST 401, wrong-token POST 404. Live build `5fc09a8174db824cf6d4` cannot establish backend Git HEAD.
- Yesterday's private-handler activation and token rotation are recorded as successful in PR #278. Do not repeat either blindly.
- Runtime, target DB and provider administration are inaccessible in this agent session. Source settings and historic screenshots do not prove current target state.

## Task 1: Read-only diagnostic and candidate comparison

Files: `scripts/ru-hands-intake-check.py`, `tests/ru-hands-intake-check.test.py`, `tests/ru-hands-intake-check.test.cjs`.

Interfaces: `collect_active(fetch_page, max_pages)`, `compare_ids(provider_rows, target_ids)`, `fetch_json(url, headers, opener, sleep)`, `log_signals(text)`. CLI accepts only `--max-pages`; no apply mode.

- [x] Tests first: canonical/legacy IDs, malformed IDs, duplicate feed rows, short provider pages, contradictory/changing metadata, page limit, invalid envelopes, retries, redirect refusal, secret-free errors, private output permissions.
- [x] Resolve one active release edge and its actual REST DB. Require release-specific shared-network match; fail closed on ambiguity. Read key presence only from Docker environment; never print values.
- [x] Fetch ACTIVE pages using the configured API key and exact fixed provider origin, verified TLS, no redirects and bounded retries. No date filter: its semantics are not verified. A failed/truncated enumeration produces no candidate manifest.
- [x] Query only IDs/counts/timestamps in explicit read-only transactions; store missing IDs privately with scope and timestamps. These are candidates, not an import authorization or complete migration-window reconciliation.
- [x] Record aggregate cron state and bounded fixed error categories without exposing command text, logs, customer fields or credentials.
- [ ] Run focused tests and build check, then the existing mandatory CI workflow on the published PR. Review diff for secrets and forbidden changes.

## Task 2: Runtime continuation (requires server access)

- [ ] Run diagnostic on RU host; inspect exact evidence and provider delivery attempts. Determine the current cause before patching.
- [ ] Review current private importer and target triggers, preserve original payload dates/contacts and existing manual changes; implement/test insert-only recovery with concurrency protection if required.
- [ ] Apply the minimal evidenced fix with file/config rollback. Compare all accessible migration-window source/provider records, including orders no longer ACTIVE, before recovering proven absences.
- [ ] Verify a real new delivery, target DB/UI, retry/idempotency, handler restart and a repeat reconciliation. Do not claim completion until these gates pass.

## Review focus

API pagination is not a transaction snapshot; reject observed total/page drift and repeat IDs. Legacy numeric and `hands:` IDs must compare equally. Unknown IDs/envelopes must fail closed. API errors/redirects must not expose keys or customer payloads. The host API probe does not prove container egress or provider-to-RU delivery.
