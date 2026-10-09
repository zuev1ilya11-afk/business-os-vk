# Hands RU intake — 2026-10-09 checkpoint

**Status: recovery is not verified.** This change prepares a read-only runtime diagnosis. It does not restore intake or import any orders.

## Confirmed in this session

- GitHub main: `a639db4dea71e605446c166ec96ca5af8abacc1a` (#281).
- RU trusted HTTPS responds on `https://139.100.237.167`. Public frontend build: `5fc09a8174db824cf6d4`. This is not proof of a backend Git SHA; the active backend release must be inspected on the host.
- `/functions/v1/hands-api`: GET → 405 `METHOD_NOT_ALLOWED`; POST without a session → 401; POST with a deliberately invalid webhook token and empty body → 404 `NOT_FOUND`. No synthetic order/delivery was sent.
- Fresh old-source read-only SQL at 2026-10-09T07:49:03Z: 118 total orders, 110 Hands orders, 150 webhook receipts; latest Hands order `2026-10-08T13:33:10.478368Z`, latest receipt `2026-10-08T13:33:10.657642Z`. Zero receipts since the prior 2026-10-08T15:10Z checkpoint.
- Fresh source function export: private Hands v11, `verify_jwt=false`, token-protected webhook with `x-hands-delivery` and `CREATED` event; session-protected manual `syncOrders`. The public tracked full handler is older and must not replace the private production function.
- New source events after cutover were already proven in [PR #278](https://github.com/zuev1ilya11-afk/business-os-vk/pull/278). That is evidence of the original routing error, not proof of the current RU failure.

## Prior evidence, not revalidated on RU today

PR #278 records successful RU patch activation at 17:11 Moscow on October 8 and installation of the replacement webhook token at 17:57. Its last corrected target check recorded 147 receipts, last receipt `2026-10-08T09:11:07.689461Z`, and one specifically checked missing order. The full provider/target comparison and genuine post-switch RU delivery were not completed. The public patch PR remains open at the start of this session.

The current public handler checks cannot distinguish provider misconfiguration, no new event, credential mismatch, DB failure, provider API failure or a display issue. No one of these is asserted as today's root cause without runtime evidence. The absence of new old-source receipts alone does not prove correct RU intake.

## Prepared diagnostic

`scripts/ru-hands-intake-check.py` runs on the RU Docker host with access to `docker inspect`, logs and read-only SQL through the actual release database. It:

- Reuses the pinned and checksum-verified `ru-check.py` from commit `2c8585c3ae4ea39a1f3d21b66e49aa907a0c3f43` of PR #278.
- Requires a single running release edge, matching REST service on the shared network and matching release DB. A healthy legacy database cannot be selected as a fallback.
- Shows runtime/restart metadata, receipt timestamps, cron counts/history and fixed error categories from a bounded log tail. A missing log error is not evidence that a request succeeded.
- Reads the existing Hands ACTIVE list through host HTTPS using the edge's `HANDS_API_KEY` without printing or persisting the key. Redirects/proxies are disabled for these authenticated reads; TLS verification stays enabled. Temporary read failures get at most three attempts.
- Requires the documented `orders,page,per_page,pages,total` envelope, complete bounded traversal, stable pagination metadata and distinct numeric IDs. Errors/limits stop the check without a recovery manifest.
- Rechecks target IDs after enumeration and treats `hands:123` and legacy `123` as the same external identity. Counts duplicate groups separately.
- Saves only candidate external IDs and provider creation times under a unique mode-0700 directory in `/opt/business-os/deploy`, with a mode-0600 `candidates.json`. No client/contact payloads are printed or saved.

Run from the reviewed checkout on the host:

```bash
python3 scripts/ru-hands-intake-check.py
```

Optional `--max-pages 1..100` changes the bounded read limit (default 20, requested page size 100, maximum total 10,000). There is **no apply mode**. The script does not restart processes, change settings, write to the application DB, send reports or import records. Its only filesystem change is the private evidence directory. Rollback of the diagnostic requires no application or database action.

This is an ACTIVE-feed candidate comparison, not a complete migration-window reconciliation. It intentionally does not assume unverified date-filter semantics. Completed/cancelled/deleted records and old-source-only events need a separate comparison. Host API success does not prove container egress, provider delivery or correct API account identity; the latter must be checked before recovery.

## Access required and continuation

This session has no SSH key/agent or authenticated server-console tab, and no authenticated RU application/DB session. The GitHub connector grants repository access, not shell access to the RU host. Hands provider administration/delivery logs are also not connected.

1. Provide an authenticated server execution channel or run this diagnostic once on `139.100.237.167`. Keep its private `candidates.json` on the server; share only its counters/fixed diagnostic output.
2. Check the current single Hands webhook destination and attempts after October 8, 17:57 Moscow (HTTP status/timestamps, without token or payload). Do not create another subscription or request blind mass replay.
3. Use the fresh runtime evidence to identify and patch the precise failing boundary; preserve exact private source/bundle/config backups and rollback only changed runtime files, never current data.
4. Before imports, compare source/provider/target by stable identity and verify account, target uniqueness, current importer, schema and notification triggers. The existing general sync can update existing orders and must not be used as an insert-only recovery shortcut.
5. Restore only proven absences through reviewed existing import rules; preserve original fields and dates, protect concurrent intake/manual edits, and repeat reconciliation. The candidate manifest contains no payloads and cannot be blindly replayed.
6. Verify a genuine new provider event in the RU database and dispatcher UI, duplicate delivery, handler restart and complete cutover-window reconciliation before declaring recovery.

## Counts and gates

| Item | Current result |
|---|---|
| All missing RU orders | Unknown; current target/provider comparison unavailable |
| Restored by this session | 0 |
| Current RU duplicates | Unknown; target unavailable |
| Production writes/restarts by this session | 0 |
| Public TLS/route/unauthorized rejection | Verified |
| Real event, DB insert, dispatcher UI, replay, restart | Not verified |

Local verification before publication: 16 targeted diagnostic tests; server suite 715 passed; `build:check` and whitespace check passed. Independent review reproduced ambiguous Docker DNS aliases and database URI overrides; both now fail closed with regression tests. CI and final review are recorded in the associated PR. None of these checks substitutes for production verification.
