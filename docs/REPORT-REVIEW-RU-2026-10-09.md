# Report act navigation and original intake date

## Confirmed cause

On the RU origin, the root-scoped service worker returned the cached app shell
for every navigation, including signed `/storage/v1/object/sign/` links. Opening
an existing act in the authenticated production review therefore displayed the
app's login/loading screen at the document URL. This was reproduced in the
browser and by a failing regression test before changing the worker.

Only the scope root and `index.html` now use the offline shell. Document and API
navigations reach the server, preserving its Content-Type and authorization
response. Signed documents are never added to the shell cache. JPG/PNG acts use
the existing report photo viewer, including its original-file link; PDFs retain
native browser opening. Existing URLs and files are not rewritten.

The review header uses only the existing `orders.created_at`, in Europe/Moscow,
as `Поступила: ДД.ММ.ГГГГ в ЧЧ:ММ`. Missing/invalid values show
`Дата поступления не указана`. Hands numbers retain the existing external-ID
display convention. Assignment, report submission and update times are not
fallbacks. No database or report writes are introduced.

## Validation and limits

- Full local server suite: 729 passing tests.
- Targeted browser suite: 15 passing tests, including existing review snapshot
  and update behavior, owner/manager/dispatcher, 390px layout, immutable intake
  date, JPG/PNG viewer reopening and native document navigation with a real SW.
- Local signed-file fixtures cover old/new paths, PNG/JPG rendering, PDF HTTP
  Content-Type, rejected unsigned access, absence of document caching and
  retained offline app entry.
- Build consistency and whitespace checks pass. Five release safety cases
  verify no-write preparation, drift rejection, exact rollback and rollback
  after failed public verification.
- The real production unsigned file request was rejected for missing token.
  Real old/new file rendering, update activation and date display must still be
  checked after release; local fixtures do not establish these production facts.

Existing signed-link bearer access is unchanged. Storage is not made public.
No Hands/Avito, auth/RBAC, payroll, status, report submission or schema change.

## Guarded RU release

Run `scripts/ru-report-review-release.py --revision <full-reviewed-commit-SHA>`
on the existing Docker host. `--check` performs read-only preparation.
The runner reuses the existing frontend installer pinned by commit and digest.
It requires production build `5fc09a8174db824cf6d4`, verifies every manifest asset,
identifies the active Docker bind mount, and rejects report-module or worker
drift. A different production baseline requires inspection, not bypassing the
guard.

Only the report-review module in the live bundle, its existing standalone source,
the service worker and version metadata are changed. RU network configuration,
unrelated bundle modules and the RU-specific absence of Pages migration code
are preserved. No container restart, backend deployment or database mutation.

Original bytes, ownership and modes are journaled privately under
`/opt/business-os/deploy/report-review-<revision>`. Files are replaced atomically,
manifest last, and published bytes are verified over HTTPS. Verification failure
restores the original bytes. Roll back using the same runner and revision with
`--rollback`; it refuses to overwrite later unrelated changes. Repeating an
interrupted run recovers the existing journal. Recovery messages from the
shared installer retain the `BOS_MASTER_HOME_` prefix.

After release, accept the existing update prompt once any drafts are saved.
The worker deliberately keeps the existing user-controlled update flow.
Reopen a real report, compare the intake date, open the act twice and verify a
historical and a post-migration document without submitting or approving reports.
Do not claim deployment solely from a Git merge or local tests.
