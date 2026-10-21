# Lemana export date correction

The report uses local ISO timestamps with milliseconds. PR297 rejected these strings, blocking otherwise valid new rows. The shared parser now accepts one to three fractional digits, preserves milliseconds during explicit timezone conversion, and identifies the failing date column. Offset-bearing/ambiguous input is not silently reinterpreted. No source, payroll, selection, duplicate, role or existing-data rule changes.

## RU update

`bos-lemana-dates.pyz` changes only `mini-app-api/lemana-import.js` and its compiled mini-app bundle. The unchanged browser already renders and selects server preview results; no frontend deployment is required. Frontend build remains `cc4fa850b12dadd27370`.

The package reuses the exact backend/frontend filesystem helpers from PR297 archive SHA256 `3fa6b44e695441a8bda6446cbe6058394feedd9b51113f36d34c39386a8daec3` (commit `5ca2043a908ee9d2c46599a2c6f973496ae7ac6e`). It requires that release's active journals, complete unchanged web/API snapshots and container configuration. It preserves their backups/journals and creates its own private stage at `/opt/business-os/deploy/lemana-date-fix-api`.

Before activation it checks schema/permissions and that import is unpaused using read-only metadata queries. It backs up all API directories, reproduces the active mini bundle byte-for-byte with the same container image and retained PR297 cache offline, compiles the candidate offline, and probes an isolated runtime using dummy credentials. Only the two permitted file contents may change. It atomically exchanges the API directories, restarts the existing edge container and verifies container hashes and health/auth/CORS. No database writes, migrations, workbook uploads or authenticated create/update requests run during deployment.

Run the pinned package after checking its published SHA256:

1. `python3 /root/bos-lemana-dates.pyz --check`
2. `python3 /root/bos-lemana-dates.pyz --apply`
3. Success: `LEMANA_DATE_FIX_OK`. A repeat verifies and reports `LEMANA_DATE_FIX_ALREADY_INSTALLED`.

Rollback: `python3 /root/bos-lemana-dates.pyz --rollback`. This restores the preceding PR297 parser/API, retaining its complete feature and schema, all orders and milliseconds already stored. It refuses later file/container drift; interruption between directory exchanges is recoverable. Repeated failed attempts are archived, not deleted. Do not run the older PR297 rollback across this later patch; its drift check will refuse. No DB dump restoration or data deletion is needed.

## Reproduce

Fetch immutable commit `5ca2043a908ee9d2c46599a2c6f973496ae7ac6e` and extract `deploy/lemana/bos297.pyz` to this directory's ignored `bos297.pyz`, then run:

```sh
python3 deploy/lemana-date-fix/build_package.py deploy/lemana-date-fix/bos297.pyz
python3 -m unittest discover -s deploy/lemana-date-fix -p 'test_*.py' -v
node --test tests/lemana-import.test.cjs tests/lemana-api.test.cjs tests/lemana-sql.test.cjs
npx playwright test tests/lemana-import.spec.js
```

All automated fixtures are synthetic. The user report is never included in the repository, tests or logs.
