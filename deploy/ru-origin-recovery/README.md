# Recovery of the deployed RU frontend after an IP change

The production shell at `https://136.234.17.113` still contains authentication
and data URLs rooted at `https://139.100.237.167`. The deployed RU fetch adapter
recognizes legacy Supabase and gateway URLs plus the current page origin, but
does not recognize the previous deployment IP. Login therefore bypasses the
adapter and sends its request to the old, selectively unreachable IP.

This guarded patch recognizes the previous IP for `/api/proxy/`, reports and
the four supported direct API prefixes. It keeps the current page origin as
the destination, preserves request bodies/headers/signals, and adds no retries.
The rest of the production bundle remains byte-for-byte unchanged.

## Scope and safeguards

- Pinned production build: `b44db0b2084a5c0cc743`.
- Pinned startup SHA-256: `258147d73909635624cd5dd2ab57e2b79d31fe78853b61ebeb51a35ac6e4bf27`.
- Checks the shell hash and every manifest asset before changing anything.
- Discovers the active Caddy `/srv` bind mount using Docker metadata and an
  exact HTTPS manifest match; does not assume that repository main is deployed.
- Updates only `startup-shell.bundle.js`, `index.html`, `sw.js` and
  `build-version.js`, with a new coherent build ID and manifest hashes.
- Backups and a recovery journal are outside the public web root, under
  `/opt/business-os/deploy/ru-origin-20261028-v1` (directory mode 0700).
- Preserves file ownership and permissions; verifies published bytes through
  HTTPS with normal certificate validation. Failed verification rolls back.
- No database, backend, credentials, volumes, networking or container restarts.

## Run on the existing production Docker host

Download `repair.py` from the reviewed immutable commit over HTTPS and verify
its published SHA-256 before execution. Python 3 standard library only.

```sh
python3 /root/bos-origin-fix.py --check
python3 /root/bos-origin-fix.py --apply
```

The default is a read-only check. `--apply` performs the same preflight before
making a backup and installing. Rerunning it verifies an already installed
release; it does not patch twice. An interrupted installation is restored from
the journal. A different frontend build or a concurrent edit causes refusal.

Rollback, while this release is still current:

```sh
python3 /root/bos-origin-fix.py --rollback
```

## Regression checks

`BOS_TEST_WEB` must point to a complete **copy**, not the active production
directory, of the pinned pre-patch web root. The tests copy it again to isolated
temporary directories. Capture only public frontend assets, never sessions.

```sh
BOS_TEST_WEB=/path/to/before-web python3 deploy/ru-origin-recovery/test-repair.py -v
```

The Node regression accepts a startup bundle path in `BOS_TEST_BUNDLE`:

```sh
BOS_TEST_BUNDLE=/path/to/before-web/startup-shell.bundle.js node --test deploy/ru-origin-recovery/test-router.cjs
BOS_TEST_BUNDLE=/path/to/after-web/startup-shell.bundle.js node --test deploy/ru-origin-recovery/test-router.cjs
```

The before version must reproduce the old-IP failures; the patched version
must pass. Tests cover login, all direct API prefixes, old-origin compatibility,
legacy gateways, unchanged unrelated destinations, POST preservation, no write
retries, manifest/SW coherence, guarded installation, rollback and refusal to
overwrite concurrent changes.

## Required follow-up

Successful deployment output proves static-file publication, not user recovery.
Verify actual login and real data without VPN, all main sections, PWA installation
on the new origin, reopening and another employee's device. The installed PWA on
the old IP remains associated with that old origin; it must be replaced with
the new-origin PWA. Separately persist the already tested eth1 source-routing
configuration before any server reboot. Keep the Caddy and network backups.

Future RU releases must retain this origin mapping; the generic repository
build differs from the deployed RU adapter and must not overwrite it blindly.
The precise upstream cause of selective access failure to the old IP remains
unconfirmed. This patch addresses the demonstrated client migration blocker.
