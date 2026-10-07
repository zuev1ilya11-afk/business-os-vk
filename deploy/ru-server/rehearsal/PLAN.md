# Isolated restore rehearsal

Spec: continue the user-authorized RU migration using the verified source backup; production and the existing target container must remain unchanged. Test full restore in a fresh database in a fresh network-disabled container and stop it afterwards. Do not treat a successful rehearsal as production readiness.

1. Test backup hash validation, safe role conversion and isolation arguments (RED then GREEN).
2. Implement a standard-library-only Python script using the already pulled image by image ID. Generate unique target credentials on server, use no source credentials, mount backups read-only, preserve owners/ACL, handle reserved roles without duplicates via conditional CREATE. Restore atomically into a fresh template0 database. Persist private logs, print only counts/metadata and sanitized error class; stop only the newly created container in finally.
3. Run local unit/syntax checks and fresh reviewer; runtime remains to be tested by user on server (Docker is unavailable in this workspace).
4. Save script and tests on the existing migration branch and provide a pinned/checksummed download command. Do not merge or deploy the app.

Review focus: any path mutating main container or source; reuse of old data; leakage in stdout or Docker command arguments; incorrect PG authentication/role transitions; failure to stop on errors; incorrect successful marker; loss of owners/ACL or data during dump restore.

Ledger: initial tests fail against explicit empty implementation. Existing migration branch is from September and will only receive standalone tooling; server app checkout stays on main 7e3fb71. No full app suite is required because no app code changes. Local Docker is unavailable, so live restore is intentionally unverified until server output. pg_net version mismatch remains a production blocker even if rehearsal succeeds.

Final review: fresh reviewer found one important cleanup exception gap; added two failing regression tests then caught stop/inspect timeout and OS errors to emit STOP_FAILED. Seven local tests pass after fix. Archive restore is transactional; cluster roles use a separate prior transaction inside the disposable cluster. Database-level ACL/settings and extension ownership are not validated by this trial. It is never promoted automatically.
