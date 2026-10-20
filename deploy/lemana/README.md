# RU deployment of PR297

Target main: `1ff029deaaa08d2d0181fea1826f912b47b19280`.
Baseline RU build: `f2c8c8ee697f23936ec2`; target: `cc4fa850b12dadd27370`.
This package extends the existing RU deployment. It never imports an XLSX or calls an authenticated production create/update endpoint.

## RU compatibility

The live shared payroll copies are three reviewed historical versions (a47464c3002e, c1807125b6a0, 74f9c8dfd44f). Their existing `calculate()` functions are preserved byte-for-byte. Lemana delegates to each handler's existing Hands calculation; the existing behavior for all other sources and saved payroll remains intact. Source/display helpers, saved Lemana snapshots and master work-price filtering are added without upgrading unrelated behavior. The service-only import RPC persists all three values returned by that calculator; it validates finite, nonnegative amounts with at most two decimals. Main's generic migration uses zero management payouts; this RU compatibility migration does not replace the existing RU rule with that later generic rule. No historical rows or payouts are updated.

Seven entrypoint hashes and existing payroll hashes are checked. Only mini-app-api's entrypoint changes; the other six are retained. Every old bundle must reproduce byte-for-byte with the same running Docker image and PR296 cache, with network disabled, before compiling candidates. The strict Hands delivery trigger fingerprint is checked as well. The existing gateway, configuration, networks, credentials, all other files and RU frontend routing are retained.

`drive-archive-api` retains its existing document naming behavior; this package does not modify the archive integration. Its handling of the order display number for the new source needs a separately verified runtime patch. This does not send Lemana reports to Hands.

## Migrations

One additive migration: `package/migration.sql`, based on `20261020180000_lemana_import_work_items.sql`, with the RU payout persistence compatibility described above. Adds nullable `orders.work_items` and `lemana_import_meta`, array constraint, identity helper, number guard and create-only service RPC. No backfill, UPDATE, deletion, employee creation, report approval or payment operation.

The installer verifies the exact existing manual-intake schema, PostgreSQL 17, function security/ownership/access grants and all new schema fingerprints. It creates a temporary **persistent write barrier** while switching runtimes (`pause.sql`); after both runtimes pass verification, `resume.sql` removes it. The barrier affects only feature-dependent rows. It stores no customer data.

## Installation

Run as root on the existing RU host. Download the immutable reviewed `bos297.pyz` to `/root/bos297.pyz` and verify its published SHA256.

1. `python3 /root/bos297.pyz --check` — read-only schema/file/routing checks; no restart or backup creation.
2. `python3 /root/bos297.pyz --apply` — reproduce old bundles and probe isolated candidates with dummy credentials; save full verified DB dump and complete web/edge backups; apply guarded additive DDL; pause feature writes; atomically swap source/bundle directories; restart only the existing edge and Caddy containers; verify host and in-container hashes and public HTTPS health/auth/CORS/assets; resume feature writes.
3. Only `RELEASE_OK` with the target build means installation succeeded. A repeated successful `--apply` verifies and reports `ALREADY_DEPLOYED`.

Backups and journals: `/opt/business-os/deploy/lemana-297-{db,api,web}`. DB dump is private (`0600`), checked with both `pg_restore --list` and a full data-block read without restoring to a database. Keep backups and package. Diagnostic output contains metadata only; private operation logs must not be posted publicly. Import parsing does not log workbook rows.

## Rollback

`python3 /root/bos297.pyz --rollback` first checks for later file/container drift. Under a transaction-level table lock it revokes the import RPC and installs an OLD+NEW row guard, then checks whether Lemana/work-item data exists. The guard prevents in-flight APIs/direct REST from creating feature-dependent data after this check.

- **No dependent data:** restore exact prior web and edge directories; retain additive schema, all customer data and the barrier. A later verified `--apply` can safely retry.
- **Any dependent data, unavailable DB, unknown schema, or later file drift:** refuse code downgrade. New feature writes remain paused if the DB barrier succeeded. Keep compatible code/data and fix forward. Never automatically restore the database dump, drop columns or delete imported records.
- **Recovery with complete target files:** after correcting the reported failure, `python3 /root/bos297.pyz --resume` verifies target API mount hashes, health/auth/CORS, exact target frontend over HTTPS and schema, then resumes feature writes. It cannot resume a mixed/old deployment.

After a refusal do not use the older PR296 installer or restore a whole DB dump over newer orders/payments. Do not manually remove the write barrier to bypass verification.

## Reproduction and tests

Prepare the baseline archive from the immutable prior deployment branch commit:

```sh
git show aeca72a43f90468b1712b48c47064ca97af4e890:deploy/order-intake/bos296.pyz > deploy/lemana/bos296.pyz
python3 deploy/lemana/build_package.py deploy/lemana/bos296.pyz
node deploy/lemana/generate_schema.cjs
python3 deploy/lemana/build_package.py deploy/lemana/bos296.pyz
python3 -m unittest discover -s deploy/lemana -p 'test_*.py' -v
node --test deploy/lemana/test_database.cjs deploy/lemana/test_payroll.cjs deploy/lemana/test_hands_boundary.cjs
```

All fixtures are synthetic. Package construction requires Git objects for the pinned main, prior deployment and three payroll baselines; dependency installation follows the repository lockfile. No production credentials or customer report are needed. Feature preview and detailed feature documentation: `docs/lemana/`.
