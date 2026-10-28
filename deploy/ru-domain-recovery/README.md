# Stable domain for the existing RU production server

Connect the user-owned `homemaster.qd.je` to the existing working production
site at `136.234.17.113`. Public DNS inspection found DigitalPlat nameservers
`dns1.digitalplat.org` and `dns2.digitalplat.org`, with no A/AAAA/CNAME record.

Required DNS change in that domain's zone: A, name `@`, value `136.234.17.113`,
TTL 300. No nameserver change, unrelated DNS records, proxy or new hosting.
The installer does not modify DNS or request DNS credentials.

Download the reviewed immutable `connect.py`, verify its SHA-256, then run on
the existing production Docker host:

```sh
python3 /root/bos-domain.py --check
python3 /root/bos-domain.py --apply
```

The installer refuses until local DNS returns only the new IPv4 and no IPv6.
It checks the current IP API over verified HTTPS, discovers/verifies the known
Caddy mount, saves a private backup, adds exactly one hostname to the existing
site header, validates and reloads only Caddy. Both IP addresses, application
routes and existing certificate policy remain present. No service restart,
database mutation, credentials, frontend deployment or network-route change.

After reload it checks the domain with normal certificate validation, three
mini-app API health requests, auth health and the frontend manifest. Failed
verification rolls back the Caddy change. User login, actual files and PWA
installation must be verified separately before declaring the domain ready.

Backup and journal: `/root/bos-domain-homemaster-20261028`.
Rollback, refusing unrelated file changes:

```sh
python3 /root/bos-domain.py --rollback
```

Validation: `python3 deploy/ru-domain-recovery/test-connect.py -v`; also adapt
the reviewed existing site header plus the new hostname with the exact
production Caddy v2.11.7 binary and inspect its host and certificate subjects.

Outstanding separate work: persist the runtime eth1 source-policy routing;
verify migration of stored attachment/backend URLs before retiring the old IP;
move employee PWA installations to the stable domain once HTTPS/login work.
Do not disable the old interface/default route as part of this change.

## Confirmed certificate limit and domain-only ZeroSSL recovery

Production diagnostics confirmed: DNS A resolves to `136.234.17.113`, IP auth
and the Let's Encrypt directory return verified HTTPS 200, and the first
deployment journal is `rolled_back` with the original Caddyfile hash matching.
Let's Encrypt returned HTTP 429: 50 new certificates already issued for the
shared registered domain `qd.je` in 168 hours. Retry-after was
2026-10-28 21:54 UTC. The later `context canceled` was caused by rollback.

`connect-zerossl.py` adds a separate domain site using the free ZeroSSL ACME
directory. Both existing IP sites and their Let's Encrypt short-lived issuer
remain byte-identical in the original part of the file. The domain copies the
same application routes. Before activation, actual Caddy adaptation is compared:
only the new hostname/issuer may differ; upstreams, handlers and other settings
must match. Generated route group names and Caddy's config-file hiding path are
normalized for that comparison. The installer refuses an unexpected topology.

Pass the owner's email with `--email`; it is used for Caddy's automatic ZeroSSL
ACME account/EAB setup, supported by the inspected official Caddy v2.11.7 source.
No API key or paid plan is required by this workflow. The installer does not
print credentials or change application authentication secrets.

```sh
python3 /root/bos-domain-zerossl.py --apply --email OWNER_EMAIL
python3 /root/bos-domain-zerossl.py --rollback
```

Private backup/journal: `/root/bos-domain-homemaster-zerossl-20261028`.
The first attempt's backup is retained. Up to five minutes are allowed for
certificate issuance, followed by verified domain HTTPS/API checks. Failure or
interruption rolls back Caddy. Database and runtime networking are untouched.

Validation: nine tests, including real Caddy v2.11.7 adaptation with API/static
routes, refusal of unrelated changes, rollback, and simulated delayed issuance.
Run `BOS_TEST_CADDY=/path/to/caddy python3 deploy/ru-domain-recovery/test-zerossl.py -v`.
Production execution and user login/PWA verification remain separate steps.

## One-time retry after the CA's advertised limit window

The ZeroSSL attempt failed during EAB account registration because its API
response could not be decoded as JSON (`invalid character 'A'`). This does not
establish the response's contents or cause. Production rolled back again; the
original hash and working IP auth were verified by the user's diagnostic output.

`retry-letsencrypt.py --schedule --email OWNER_EMAIL` prepares a separate domain
site with normal Let's Encrypt ACME issuance. The existing IP short-lived policy
and routes remain unchanged. It validates/adapts the candidate now, without
reloading Caddy, then installs a private immutable script snapshot and creates
one transient systemd timer for **2026-10-28 21:55 UTC / October 29 00:55 Moscow**.
If that time has already passed, execution is scheduled five seconds later.
Both previous attempt journals and original hashes are checked at execution.
Rate-limit exhaustion can still recur on the shared suffix; this is one attempt,
not a guarantee of domain readiness at the specified time. HTTPS failure rolls
back and is recorded. No browser or terminal needs to remain open.

```sh
python3 /root/bos-domain-le-retry.py --status
systemctl stop bos-domain-le-20261028.timer
python3 /root/bos-domain-le-retry.py --rollback
```

Stopping the timer cancels a future run; rollback applies after activation.
Scheduled script/journal: `/root/bos-domain-le-scheduled-20261028`.
Activation backup/journal: `/root/bos-domain-homemaster-le-retry-20261028`.
Do not reboot before networking is persisted; the timer is also transient.
Validation: 13 tests, real Caddy adaptation, and systemd calendar normalization.
