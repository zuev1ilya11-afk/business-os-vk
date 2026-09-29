# Appointment time and master identity

`schedule-contract.js` loads before schedule consumers. A valid `scheduled_time` is the appointment start; otherwise use the start of `time_slot`. A valid positive slot pair supplies duration, even if its start differs from `scheduled_time`. Missing or invalid duration falls back to 60 minutes. SQL seconds are accepted at minute precision. `24:00` is valid only as an end. No valid start means no interval.

Conflict checks use exact half-open intervals. Moves preserve duration and reject overflow beyond the current day. The 30-minute resize grid is an explicit user operation, not a data-normalization rule. Off-grid labels and horizontal offsets retain minutes. Master report deadlines use the same duration and local schedule date; +90 minutes is inclusive.

Master aliases are resolved through the staff directory. Order `id` and `external_id` are never staff identities. A name fallback is allowed only when the order has no master ID, and empty names never match. Distinct explicit IDs take precedence over equal names. No stored order is migrated.

Mobile conflict groups, desktop schedules, quick move, smart assignment and master daily-home deadlines share these rules. Smart assignment reserves the entire duration, including shift-end checks.

Validation: 199 server checks, targeted schedule/move/assignment UI tests and the full mandatory PR CI. Parser regressions include mismatched fields, SQL time, one-digit hours, malformed ranges, midnight, alias identity, precise duration and UTC/Moscow +89/+90/+91 boundaries. The legacy alias UI fixture is applied at the client boundary because bootstrap normally expands staff foreign keys.

The older open schedule PR #187 overlaps this area and must be rebased/reviewed separately; it was not merged or closed by this change. No financial, authentication or database behavior changes.

PR CI initially exposed a pre-existing quick-editor test race: role-loader refresh detached the card during `scrollIntoViewIfNeeded` (both attempts). The test now reacquires the locator within its existing five-second assertion window, retaining the 44px touch target and hit-test requirements. Ten targeted repetitions pass; no product assertion, workflow retry count or test timeout was relaxed. A separate resize scenario was flaky on that run; exact-head CI must pass before merge.
