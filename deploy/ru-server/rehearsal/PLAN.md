# Isolated restore rehearsal

Spec: continue the user-authorized RU migration using the verified source backup; production and the existing target container must remain unchanged. Test full restore in a fresh database in a fresh network-disabled container and stop it afterwards. Do not treat a successful rehearsal as production readiness.

1. Test backup hash validation, safe role conversion and isolation arguments (RED then GREEN).
2. Implement a standard-library-only Python script using the already pulled image by image ID. Generate unique target credentials on server, use no source credentials, mount backups read-only, preserve owners/ACL, handle reserved roles without duplicates via conditional CREATE. Restore atomically into a fresh template0 database. Persist private logs, print only counts/metadata and sanitized error class; stop only the newly created container in finally.
3. Run local unit/syntax checks and fresh reviewer; runtime remains to be tested by user on server (Docker is unavailable in this workspace).
4. Save script and tests on the existing migration branch and provide a pinned/checksummed download command. Do not merge or deploy the app.

Review focus: any path mutating main container or source; reuse of old data; leakage in stdout or Docker command arguments; incorrect PG authentication/role transitions; failure to stop on errors; incorrect successful marker; loss of owners/ACL or data during dump restore.

Ledger: initial tests fail against explicit empty implementation. Existing migration branch is from September and will only receive standalone tooling; server app checkout stays on main 7e3fb71. No full app suite is required because no app code changes. Local Docker is unavailable, so live restore is intentionally unverified until server output. pg_net version mismatch remains a production blocker even if rehearsal succeeds.

Final review: fresh reviewer found one important cleanup exception gap; added two failing regression tests then caught stop/inspect timeout and OS errors to emit STOP_FAILED. Seven local tests pass after fix. Archive restore is transactional; cluster roles use a separate prior transaction inside the disposable cluster. Database-level ACL/settings and extension ownership are not validated by this trial. It is never promoted automatically.

Server trial 2026-10-07: failed before archive import with permission denied to CREATE ROLE SUPERUSER. Fresh trial postgres is not superuser despite earlier partial foundation reporting otherwise. Fix: authenticate bootstrap as existing supabase_admin and verify its current rolsuper before any CREATE. Do not elevate postgres. Two regressions reproduced the original role failure and absence of the privilege gate, then passed after fix; nine local tests now pass. Supabase admin authentication and archive restore still require next server trial.

Server trial y94x0fw6 succeeded: orders 114, staff 14, auth_users 1, storage_objects 374, cron_jobs 4; cron off, pg_net 0.20.3. Container is stopped. Export of the three Vault plaintexts to a mode-0700 server-only vault-export directory succeeded; plaintexts never sent to chat.

Vault follow-up: add a standalone script for the existing stopped, labelled, network-none trial. Validate export hash/set and target isolation before starting; compare UUID/name/description/timestamps with restored snapshot; encrypt in one transaction and verify exact plaintext equality inside PostgreSQL. Stop/start and compare again to prove key persistence; always stop at exit. Only summary markers reach terminal. Retain the protected export for the later real restore; never promote the trial automatically.

Ruling: Vault 0.3.1 update_secret cannot rekey a dump because its DECLARE block decrypts the old ciphertext before using new_secret. Use the identical _crypto_aead_det_encrypt expression verified in the source extension function, retaining UUID, nonce and metadata. Restrict execution to extension 0.3.1 and confirm through decrypted_secrets before commit. Cost if wrong: transaction fails in the isolated copy; production is unaffected. No extension functions or ACL are altered.

Vault local verification: four new tests first failed with absent implementation, then passed; complete suite 13/13 and syntax check passed. Fresh reviewer independently read the complete Vault addition and reran 13/13 tests: no Critical, Important or Minor findings. Ruling on declined runtime judgment: local checks validate input/isolation guards only; live encryption, Docker execution and root-key persistence must be established by the user-server run and BOS_TRIAL_VAULT_OK marker. Cost if wrong: no completion claim until live output; the original dump and protected export remain available.
