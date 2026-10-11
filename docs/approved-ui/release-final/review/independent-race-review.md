# Independent race diff review —21bc08d /450d89745b2f499f091b

Read-only review of the diff and existing evidence; no tests/server/production were run by this reviewer.

## Resolved findings, within observed evidence

- **Late home reset:** `dispatcher-attention-v123.js:74` now rechecks both `state.page==='home'` and dispatcher-workspace permission inside the zero-delay callback. It therefore does not overwrite a newer finance route. No auth/API change.
- `tests/release-final-startup.spec.js:5–14` deterministically intercepts the module's queued zero-delay callbacks, navigates to finance, and releases them. `startup-red.log` shows the finance visibility assertion failing before fix. `race-green.log:153` and full `playwright-verified.log:42254` show the same test green after fix. This is observed regression evidence, not sleep-based inference.
- **Competing dispatcher sibling order:** `dispatcher-smart-dispatch-v121.js:79–83` now places recommendations after the matching same-order `.dq159DesktopActions` when present. This agrees with v185 ownership of the first slot after the card, yielding card → quick actions → recommendations. The same-order check avoids anchoring to an unrelated bar; compact-card insertion remains unchanged.
- The existing assignment test now observes child-list movement of the two action blocks for12 animation frames and asserts zero movement plus correct pairing, then performs the real non-forced Assign click and original payload/money checks. `race-green.log:533` and full `playwright-verified.log:21227` show it green. The observer window proves this tested stable composition, not arbitrary infinite-duration behavior.
- The `/?force_vk_auth=1` fixture flag disables only the separate localhost legacy bootstrap. Mandatory auth and fixture session validation still execute; production hostname never enters that localhost auto-init. This is a valid production-equivalent fixture choice. It is separate from and does not replace the real callback-time race fix.

No new P0/P1/P2 was identified in these two narrow runtime edits. Assignment, finance calculation, native auth and permission methods were not replaced by this diff.

## Remaining release evidence

Personally read full current log ends **746 passed /2 failed**:
1. `tests/approved-ui-master.spec.js:6`, detail bounding-box assertion between renders.
2. `tests/master-compact-card.spec.js:38–42`, dispatcher clear comment expected empty but immediate mocked DB read retained previous comment after reload/save.

These remain unresolved at this independent checkpoint; parent is investigating. Do not promote full suite to PASS from focused green.

Master header/auth-shortcut assertions now verify the canonical profile and credential modal separately. Day-filter horizontal strip exception is paired with scroll/activation/hit-test assertions; it is not merely suppressing overflow checks.

The visual144-screen review remains tied to a110 contact sheets. Any further runtime/CSS fixes require appropriate new evidence. Hosted Preview is still blocked and is not independently verified.
