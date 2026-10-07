# Isolated service trial implementation plan

> Execute inline with superpowers:executing-plans; one fresh final review.

**Goal:** One server invocation verifies REST, Auth and all374Storage objects on a separate isolated clone.

**Architecture:** Copy the stopped validated PG17.11 trial data and its private encryption volume into a fresh directory. Start a new network-none database; REST/Auth/Storage share its loopback-only namespace. Validate Vault and pre-service ACL before starting APIs, then exercise reads and one synthetic Storage object lifecycle. Stop every newly created container in reverse order on every exit.

**Tech stack:** Python standard library, Docker, existing reviewed validators, Node24 inside official storage image.

**Spec:** Continuing migration scope and server evidence in PLAN.md. Original business-os-db, original bos-restore-trial-avcpcsf0, cloud production and source snapshots stay unchanged. No cutover authorization inferred.

## Global constraints

- PostgreSQL exact candidate manifest sha256:4b438c22395a9a2bd19ee0522742cc9a1ff91db4732ff0c1b08fc07e9c767c22.
- Official pinned-source compose tags: postgrest/postgrest:v14.17, supabase/gotrue:v2.196.0, supabase/storage-api:v1.74.0. Resolve linux/amd64 immutable image IDs after pulling; persist provenance.
- Source snapshot374objects/23749699bytes, source dump SHA must match the snapshot manifest. Validate every filename/hash/size/MD5 before copying; no symlinks or traversal.
- Storage v1.74.0 file backend verified against upstream: root/global_bucket/tenant_id/bucket/name/version with TUS_USE_FILE_VERSION_SEPARATOR=false. Use global_bucket=stub, tenant=stub; set user.supabase.content-type and user.supabase.cache-control xattrs. No source metadata updates for byte assembly.
- No network bridge/host network, published ports or automatic restarts. DB cron off; shared namespace has loopback only. Docker image pulls occur outside application execution.
- Generate trial-only JWT/API keys and service-role DB passwords on server. No recovered business secrets needed for this stage. Read original loader environment privately; no credentials in arguments, terminal or reports.
- Core functions only: REST count/read and denied-anon test, Auth health/adminread/deniedanon (no user creation/password change), Storage all-object byte/type check, private-anon denial and new synthetic bucket/upload/read/sign/delete lifecycle. Never invoke business mutation RPCs.
- API URLs fixed to loopback; redirects rejected. Signed test URLs restricted to same Storage origin/path. Probe failures print phase/status only, never tokens, response bodies or user rows.
- Private logs/report and working copy retained; success printed only after all checks and confirmed stop. Errors after start must still stop all created names, including ambiguous create acknowledgements.

## Review focus

1. Copy only validated stopped source mounts read-only, copy root-key volume too; do not accidentally start or modify source.
2. Validate archive manifest and filesystem paths, xattrs and binary content; no symlink escape or silent byte mismatch.
3. API containers truly share only clone network-none namespace; no port/external route; secret-safe configuration.
4. Cleanup covers timeout, partial create and stop failure. No success marker if a container remains running.
5. API probe validates bytes and authorization, restricts mutations to a fresh synthetic bucket, and cannot follow returned URLs off-origin.

### Task1: fixture validation and image/container arguments

Create service_trial_files.py, test_service_trial_files.py. Reuse backup_storage.validate_manifest.

- [x] Write tests: valid snapshot copies correct versioned layout/content/xattrs; tampered/checksum/missingobject/traversal/symlink refused; SHA bound to verified source dump; read-only source mount and stopped candidate required.
- [x] Run python3 -m unittest test_service_trial_files -q; expected missing-module failure.
- [x] Implement read_storage_snapshot(folder,backup), materialize_storage(snapshot,destination), source_mounts(info,name), make_jwt(secret,role).
- [x] Run tests; expect green. Persist local commit.

### Task2: service orchestration and HTTP probe

Create rehearse_services.py, service_probe.mjs, test_rehearse_services.py, test_service_probe.mjs.

Consumes Task1 helpers; existing resolve_image, validate_container, stop_trial, access baselines, Vault read_export/PREPARE/CHECK_METADATA/CHECK_VALUES.

- [x] Write failing tests for source protection/network arguments, secret isolation in env files/argv, ambiguous create cleanup, stop failure suppressing success; Node fetch-double tests for redirect/off-origin rejection, wrong bytes, anon exposure and isolated synthetic lifecycle.
- [x] Implement clone copy/create/readiness, ACL/Vault guards, onlythree service password resets in clone with logging disabled, service configs/start and probe, count check, durable report and unconditional reverse-order stop.
- [ ] Probe realservices on server only: expected orders114/staff14/authusers1/storage374/vault3/cronoff; all374files exactSHA256/size/type; API lifecycle checks true; original containers remainstopped/untouched.
- [x] Run targetedtests then fullsuite and syntax; no localDocker is available, retain live gate explicitly.

### Task3: review and delivery

- [x] One fresh review of the complete new service-trial change; fix Important/Critical with failing regressions and onegreen suite, no repeated review.
- [ ] Publish on existing feat/ru-infra-migration-v172 branch, nevermerge. Include service_trial.SHA256SUMS for dependencies.
- [ ] Verify remote contents at immutablecommit. Supply one git-archive/checksum/run block.
- [x] BOS_SERVICE_TRIAL_OK means this scoped runtime trial only; no full migration success claim.

Self-review: snapshot validation feeds exact probe paths/hashes; cloned DB loader credentials preserve access while local service passwords are separately generated. Vault comparison uses existing verified export and no rekey. Admin extension-owner exceptions remain explicit. Fixtures are root-private and container-read only where possible. An already authorized inline preparation task does not need another plan-approval round trip.
