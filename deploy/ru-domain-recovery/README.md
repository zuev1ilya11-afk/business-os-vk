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
