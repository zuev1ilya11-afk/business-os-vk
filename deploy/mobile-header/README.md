# Mobile header — existing RU server

Application PR: #294. Reviewed source: `6592016d8c30f997bdc1724460a1405a845da46d`.

Target: `https://139.100.237.167/`.
Observed baseline: `4960149db306fca8149a`.
Candidate: `2f2dbcab6f4f8b4881cb`.
Package SHA-256: `1fbbd07d98ff77ccf3019c0c6728e31957372a659082ae0adc1e466e03d2ac7f`.

Only `approved-ui.css`, `index.html`, `sw.js`, and `build-version.js` are replaced.
The HTML and service worker differ only by the build ID. The manifest changes
only its ID, shell hash and stylesheet hash. Every existing JS asset, bundle,
server route and help-editor asset is retained from the active RU release.
Do not copy the generic Pages frontend to this server.

## Server execution

Download `deploy/mobile-header/bosheader.pyz` from an immutable reviewed commit
to `/root/bh.pyz`, and verify the package SHA-256 above. Use the existing server's
root console. Stop at any error; do not run a later command after a failed check.

```bash
python3 /root/bh.pyz --check
python3 /root/bh.pyz --apply
```

`--check` must end with `CHECK_OK`. It discovers the existing Caddy `/srv` bind,
checks the exact baseline hashes and public HTTPS, and does not modify services.
`--apply` repeats the checks, backs up the full web tree, prepares a verified
copy, atomically exchanges directories, and restarts only the existing Caddy
container to refresh its directory mount. There may be a brief web interruption.
Success ends with `DEPLOYED BUILD_ID=2f2dbcab6f4f8b4881cb`.

Backup and journal: `/opt/business-os/deploy/mobile-header-294/`.
Activation failures trigger rollback; after interruption use:

```bash
python3 /root/bh.pyz --rollback
```

Rollback refuses unrelated later changes. Retain the archive and backup. The
existing production API, database, users, notification settings and keys are not
modified. Reopen/update the app through its existing update flow after deployment.

## Validation and limits

- 43 targeted UI tests and build consistency checks passed on the main-based PR.
- Six package tests exercise real filesystem exchange, untouched files, backup,
  exact rollback, failed restart/HTTPS, baseline mismatch and later-change refusal.
  Docker and HTTPS are simulated in these installer tests.
- Runtime installer is reused from `deploy/pr289/package/frontend.py`; only its
  release identity, stage directory and description are changed. No backend code
  is included in the archive.
- Real server preflight/activation and authenticated iPhone/PWA checks must still
  run. Preparation or a GitHub merge does not establish production deployment.

Rebuild from the verified public snapshot, with the source commit available:

```bash
python3 deploy/mobile-header/build_package.py /path/to/verified-snapshot
python3 deploy/mobile-header/test_release.py
```
