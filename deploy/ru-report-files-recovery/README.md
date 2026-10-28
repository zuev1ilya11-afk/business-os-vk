# Report file URLs after the RU origin migration

The API migration fix routes fetch requests to the current origin. Report
thumbnails, the photo viewer and document links use `img.src` and `a.href`
instead of fetch and previously kept saved URLs at `139.100.237.167`.

This patch changes the two report URL helpers to use the active RU storage
origin for URLs on that exact previous origin under `/storage/v1/`. It preserves
object paths, queries and fragments, keeps the protocol checks, and leaves
Google Drive, other origins and non-storage URLs unchanged. Generic builds
without `BOS_RU_NETWORK` retain their existing behavior.

Report approval and stored database values are not changed. Accepted reports
are supported as well as the pending-review screen. No files are reuploaded.

## Evidence and limits

The currently published build `eeab4bcbb9972d4fc3fb` still contains the original
URL helpers. Regression tests reproduce the old-origin thumbnail, viewer,
document and review-screen behavior, and pass after the change. The user's
actual photo URL has not been available to inspect; these tests do not prove
the existence of that individual stored object or repair unrelated external
links. Verify the actual report after installation before declaring recovery.

## Guarded production installation

Download `repair.py` from the reviewed immutable commit and verify its SHA-256.
Then run on the existing Docker host:

```sh
python3 /root/bos-photo-fix.py --check
python3 /root/bos-photo-fix.py --apply
```

The default is read-only. The installer requires the exact current startup
hash `ee63dde19eb846b9c43ebd0ca8fd05c6ece75bc44314c747f27426be007cad3e`,
validates every manifest asset, finds the active Caddy bind mount, and updates
only startup bundle, HTML shell, service worker and build manifest. Normal
HTTPS verification remains enabled. Failure restores the previous files.
No containers, database, credentials or network configuration are changed.

Backups and journal: `/opt/business-os/deploy/ru-report-files-20261028-v1`.
Rollback refuses to overwrite another deployment:

```sh
python3 /root/bos-photo-fix.py --rollback
```

## Validation

Use a complete copy of the pre-patch production web directory:

```sh
BOS_TEST_WEB=/path/to/before-web python3 deploy/ru-report-files-recovery/test-repair.py -v
BOS_TEST_BUNDLE=/path/to/after-web/startup-shell.bundle.js node --test deploy/ru-report-files-recovery/test-photos.cjs
BOS_TEST_BUNDLE=/path/to/after-web/startup-shell.bundle.js node --test deploy/ru-origin-recovery/test-router.cjs
```

Nine installer/rollback checks, nine report-link checks, seven API-routing
regressions and two existing service-worker document-navigation checks passed.
The unpatched production bundle fails the old-origin report-link regressions.
Only the two intended modules change in the production bundle. Signed storage
tokens and fragments are preserved exactly; no signature or permissions change.

After deployment, refresh the new-origin application and open the accepted
order's report. Check thumbnails, full-size images, original links and the
act, then reopen the application/PWA. Confirm from a connection without VPN.
The earlier eth1 persistence task remains separate and must be completed before
a server reboot.
