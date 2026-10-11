# Approved UI release handoff

User scope is isolated synthetic read-only HTTPS Preview, then STOP. This document prepares a possible future frontend release; it does not authorize or perform a production release, main merge, push, PR, server change or external integration action. Controller owns Preview publication and independent review. Current hosted Preview is a separate checkpoint and local fixture tests do not certify it.

Final application source `cfd6740b2f92e56e7a9a6063fa19e0ee737391b5` loads `cdd3ea4f917ba89765d0`. Baseline source30e loaded8db. Final evidence commit adds docs/tools/captures without runtime changes. Fresh origin/main fetch succeeded at736c819a388e3b973a81c55f53a2a4832d9c1054; ancestry is conflict-free. No merge is needed.

[Exact frontend allowlist and SHA256](stage-6/release-hashes.json) enumerates48 runtime files changed against merged main. [Protected comparison](stage-6/protected-functionality.json) checks250 surfaces, only4 memo presentation/generated changes against accepted runtime,0 unexpected/backend changes. Tests/fixture data/docs/captures/tooling are excluded from any production upload. No demo data is introduced in app runtime.

The controller-provided read-only production manifest is `/workspace/scratch/73e5936a7e6d/recovery/production-build-readonly-2026-10-11.json`, SHA256 `8672541961129af4f8c63964fa1a50f8b0b7d3c7c27a8ed8c238b5bb55fa13cd`. It reports build `4fc3f2c9077bbc8a64eb`, shell `44d53c36f724b3f31630eeb98eb478689949836c0499662dbbbf207fde88ba95`,51 assets: 36 same, 15 different, 0 missing versus final candidate. It is a captured manifest, not a fresh server audit or proof that repository equals current Russian runtime. No server request was made for this handoff.

## Future authorized release guards

The production gate is CLOSED. If separately authorized later, obtain the actual server document-root/release mechanism from its owner; no server path or destructive shell command is assumed here. Before changing anything, read and hash the exact live frontend allowlist, index, build-version, generated startup bundles and SW/manifest assets. Save immutable timestamped backup bytes plus `before.sha256`, permissions, release pointer, source build and the complete live manifest. Verify backup hashes match observed live bytes; abort on missing files, unexpected drift or an incomplete backup. Do not rely on this historical51-asset manifest as a current guard.

Prepare a separate versioned candidate directory from the allowlist and its required coherent dependencies. Recompute every SHA256 against release-hashes.json and the generated build manifest. Run build:check before transfer; validate that index shell, build-version, asset URLs, source-to-bundle map and SW cache/build constants agree. Preserve backend/configuration/credentials/DB/functions/jobs without edits. Review exact candidate-versus-live differences and record operator authorization.

Publish only through the confirmed atomic frontend release pointer/swap, with all immutable assets present before the shell becomes visible. No partial in-place overwrite of index/SW/version/bundles is acceptable. Validate read-only health, actual build/asset hashes, role landing routes and PWA update behavior before considering the release successful. Runtime failures,404, stale mixed build or unexpected hashes require rollback rather than live guessing.

Rollback uses the verified immutable backup and original release pointer. First hash the currently served candidate against expected after hashes; if someone else has changed it, stop and reconcile rather than overwrite unknown changes. Atomically restore the original coherent frontend, verify all before hashes/build/SW references, and record outcome. Do not roll back database/API/backend because none were changed. Retain backup until the authorized release is accepted.

## Reviewable evidence and unresolved limits

Read [verification.md](verification.md), [coverage.md](coverage.md), all76 exact failure dispositions, fresh comparisons and initial/scrolled diagnostics before a gate. Baseline complete browser run remains622/76; all76 have passing narrow closures, but no full suite was rerun on finalcdd. Memo-only RED/GREEN and existing asset test pass. Physical devices, hosted auth/PWA/push, live external integrations and deployed production remain unverified. Accepted saved-hours/draft and desktop density minors remain. The initial PDF overlap remains documented with successful scrolling/trial-click proof, not universal usability clearance.
