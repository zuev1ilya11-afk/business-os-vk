# Receipt date: scoped production frontend release

Source change: `73cbd60ac09792403011ef92246796d1eedc27d1`.
Observed baseline: `2601cb81e246db1511dc`, confirmed in the server console.
Observed container: `bos-release-to2wblxf-https`, with the read-only bind
`/opt/business-os/deploy/release-to2wblxf/web` → `/srv`.
Public origin: `https://homemaster.qd.je`.

`bos-received.pyz` contains the reviewed exact-context edits, the installer,
and the existing frontend backup/atomic-write/rollback helper (pinned by SHA-256
in `build.py`). It requires only Python 3 and the existing Docker CLI. It does
not download source dependencies or need Git/npm on the production host.

The installer validates the observed mount, build ID, every manifested asset,
the public shell/manifest/service worker, and all patch contexts before writing.
It applies only receipt-date hunks to five source files and their runtime bundle,
retaining server-specific origins, report fixes, config, and unchanged modules.
The current HTML, service worker and build manifest receive matching new version
metadata. Backend, database, containers, proxy configuration and secrets are not
modified. Containers are not restarted.

Run each command separately as root on the existing server, using the package
downloaded from its immutable artifact commit:

```sh
python3 /tmp/bos-received.pyz --check
```

On `RECEIVED_CHECK_OK`:

```sh
python3 /tmp/bos-received.pyz --apply
```

Success prints `RECEIVED_DEPLOYED`, the new build ID, and the backup location.
`--apply` repeats all checks and takes a backup before changing production.
Any failed write or public verification triggers restoration of the changed files.
After a hard interruption, retain the journal and run the explicit rollback:

```sh
python3 /tmp/bos-received.pyz --rollback
```

Backup/journal: `/opt/business-os/deploy/master-received-73cbd60` (0700).
Rollback refuses to overwrite a subsequent release or unrelated live-file change.
Repeated application verifies the already deployed version; it does not overwrite
the backup. After rollback, retain the stage for inspection before retrying.

Local packaging and verification:

```sh
python3 deploy/master-received-date/build.py
python3 -m unittest discover -s deploy/master-received-date -p test_release.py -v
python3 tests/ru-master-home-release.test.py
```

After publication, check an authenticated master's home and order list, including
manual dates and an order with no receipt date. Filesystem/HTTPS verification
does not replace that device check. Refresh the PWA through its normal update
flow; do not clear user data or drafts.
