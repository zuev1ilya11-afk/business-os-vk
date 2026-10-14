# Business OS PR 289 — existing RU server release

Target: https://139.100.237.167/.
Approved application PR: https://github.com/zuev1ilya11-afk/business-os-vk/pull/289.
Main merge: `99ae7b989d6adbce10d00fe4ebebfc2ad136150c`.
Reviewed PR head: `87de64132544aeb8e707b538f975ef8ac0e698ab`.
CI: https://github.com/zuev1ilya11-afk/business-os-vk/actions/runs/38617335176.

## Release contents

| Version | BUILD_ID |
|---|---|
| Current RU frontend | `a46540428ef13967c60a` |
| PR's generic frontend | `f891805f9c6b8e31c988` |
| Prepared RU frontend | `05f9f54b55a82dd2eff6` |

The RU build preserves the existing server routing and all unrelated bundled
modules. It incorporates the reviewed push subscription fixes and mobile viewport
module, regenerating HTML, startup shell bundle, build-version.js and sw.js as one
consistent release. The eager bundle and other manifested assets remain exact.
The complete live web directory is copied, checked, then atomically exchanged;
unchanged CSS, bundles, images and files are retained. Existing ownership and
permissions are retained. Only the existing Caddy and edge containers restart.

The active push-api source must match SHA-256
`6bd9d08bf8615854f5e5ce8c475869f9e6bb11f5b9c3fa2adcaa1cad33cb7113`.
Its replacement is the reviewed CORS-only addition of the current origin, SHA-256
`974b7078e0448ed830ec28f82392ef4f3304687e631112983fd6bd400c076869`.
The installer reconstructs the old bundle with the exact running Docker image and
requires byte equality with the deployed bundle, disconnects the compiler network,
and compiles the CORS change with those same cached dependencies. The candidate
is tested on a separate network-none runtime using dummy credentials.

No database migration, database writes, VAPID rotation, notification sends,
environment changes or changes to other handlers are performed. Probe requests
are OPTIONS, health and status without a session; the latter rejects before any
database access. The preserved RU fetch adapter rewrites legacy `/api/proxy/`
strings to the effective `/functions/v1/` route. Gateway CORS headers may be `*`;
the handler change is additionally verified by source hashes and compilation.

## Server commands

Download `bos289.pyz` from the pinned release-artifact commit. Run from the server
console as root; no need to paste the installer source:

```bash
python3 bos289.pyz --check
python3 bos289.pyz --apply
```

`--check` verifies the current filesystem/container baseline and trusted HTTPS.
It does not restart services or create staging files. Compilation and isolated
runtime validation are gates inside `--apply`, before production changes.
The compiler requires at least 1 GiB available RAM, free disk space and `nsenter`.
The baseline compiler may download npm dependencies; a byte mismatch stops safely.

Success ends with:

```text
RELEASE_OK BUILD_ID=05f9f54b55a82dd2eff6
```

Short interruptions are possible while the existing containers restart. On errors,
do not manually overwrite runtime files or remove backups. Preserve the full output.
Known activation failures trigger rollback; SIGKILL/power interruption requires
the explicit rollback command below.

## Rollback and retry

```bash
python3 bos289.pyz --rollback
```

Backups/journals are under `/opt/business-os/deploy/pr289-web` and
`/opt/business-os/deploy/pr289-api`, mode 0700. Retain the package and both directories.
Rollback restores the exact web tree plus original push source/bundle and restarts
the same containers with unchanged settings. It refuses unrelated later changes.
If an HTTPS check fails after web files are restored, it still attempts backend
restoration, then reports incomplete verification. Re-run rollback after resolving
the reported problem. After a successful rollback, `--apply` verifies the baseline
and archives previous attempt directories as `pr289-*-history-*` before retrying.
These archives are retained, not deleted.

## Verification boundaries

Application CI succeeded. Local review checked build consistency, 36 push unit
tests and 21 mobile/push browser tests. Deployment code has separate filesystem
and injected-failure tests (24 passing; Docker/network boundaries simulated) and independent
review. Real pinned-image compilation and isolated Docker probes must still pass
on the server; preparing this package does not deploy it.
The 21 mobile/push browser tests also passed against the actual RU candidate.

After `RELEASE_OK`, verify trusted HTTPS, the live build/assets, login with an
existing account, the registration screen/flow, service worker registration and
update, mobile layout and notification settings. Authenticated production checks
require the user's session; no production account is created by this installer.
For an already-open tab, reload/update into the new service worker release.

Physical phone delivery requires an actual device test. Automated subscription
tests or a queued-test response do not prove delivery. iPhone notification
`permission=denied` requires a manual settings change. Following an origin change,
open/install the app from the new address; old-origin permissions do not transfer.

## Installer regression tests

From this directory in a checkout of the artifact branch:

```bash
python3 test_release.py
```

Tests use real temporary files and atomic directory exchange, synthetic baseline
fixtures and explicit fake Docker/network boundaries. They also ensure the zipapp
contains the exact reviewed Python sources and declared payload hashes. No access
to production is needed. Linux/root is used for uid/gid-preservation integration
tests, matching the intended server execution environment.
