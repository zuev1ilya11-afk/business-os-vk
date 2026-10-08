# Master home: days, new orders, contact waiting

The approved master home is implemented in the existing `master-daily-home-v127.js` module. Its shared classification model produces the cards, tab counts and callback filter from the same deduplicated, master-scoped order list. Moscow dates remain independent of the browser timezone.

Orders with an active visit stay in their day; a current undated reschedule overrides the stored old date until a later agreement. A contact callback never becomes a visit. New orders require explicit loaded contact fields, an empty journal and no prior processing. Records created before 2026-10-05 Moscow time are conservatively marked for clarification when their contact history is otherwise empty: SQL defaults introduced with the journal cannot prove that these legacy records were never contacted. Existing travel/work/report stages remain visible.

Contact results, phone selection, agreement and stage actions reuse existing server handlers. The patch adds no schema, API, access-control, payroll, dependency or backend changes. Claims and day summaries retain their existing sources and navigation.

## Verification

- `npm run build:check` and `git diff --check`.
- `npm run test:server`, including 16 classification cases and the Python release-helper suite.
- Browser regressions in `master-home-tabs.spec.js` exercise 360, 390, 430 and 1280 px, real mocked-server result persistence, denied saves, second-phone agreement, legacy stages, counts and refresh stability. Existing home assertions were updated to the approved layout without removing business checks.
- Repository `smoke` CI remains required before merge; it also checks Deno, SQL and the full browser suite.
- Synthetic fixtures only. Actual production order data has not been modified for QA.

## RU release

The active address is `https://139.100.237.167/`. The publicly inspected baseline was `d1bd2bcf02ef88e9cb6c`. GitHub main redirects the old entry to RU; deploying the repository's entire static root over RU would therefore be incorrect. GitHub merge alone does not deploy this server.

`scripts/ru-master-home-release.py` updates only the three reviewed frontend modules and related bundle/version files in the existing Docker bind mount. It verifies the exact live baseline and all asset hashes, preserves the existing RU routing/configuration and other bundle modules, and refuses a changed or ambiguous release. The server needs Python 3.9+ and Docker inspection access. No container restart is required.

From the existing server console, download this helper from the immutable reviewed commit and use that same full SHA for `--revision`:

```bash
python3 /tmp/ru-master-home-release.py --revision FULL_REVIEWED_COMMIT --check
python3 /tmp/ru-master-home-release.py --revision FULL_REVIEWED_COMMIT
```

The first command prepares and validates a fresh release without changing frontend files. If a journal already exists, `--check` reports only its recorded status; it does **not** certify that the current frontend is still deployed. A normal repeated invocation checks every recorded file and the public root again.

The installer saves exact backups, permissions and a durable recovery journal under `/opt/business-os/deploy/master-home-FULL_REVIEWED_COMMIT`. It verifies the public root plus all changed runtime resources over HTTPS; a failed check restores the previous files. An interrupted installation is recovered by the next normal invocation. Manual rollback is:

```bash
python3 /tmp/ru-master-home-release.py --revision FULL_REVIEWED_COMMIT --rollback
```

Rollback refuses to overwrite unrelated later changes. It restores frontend files only and does not touch real business data. Record the emitted `BUILD_ID` and backup path. Then verify the master tabs, navigation and normal PWA update on an authenticated device without clearing saved application data. The helper's byte verification does not replace this authenticated smoke check.

No SSH session or server-console credential is available in the current agent environment. This document and helper are a reviewed deployment handoff, not evidence that the feature is published.
