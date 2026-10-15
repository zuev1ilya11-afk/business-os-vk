# Contact control pilot implementation plan

Spec: [spec.txt](spec.txt). Baseline: d350079 (main, includes mobile safe-area PR 294).

Goal: one atomic contact outcome → existing control task → server reminder → manager exception queue.
Architecture: extend PostgreSQL bos_control_private.tasks and existing signed-session master-workflow-api; retain push delivery pipeline and existing Control UI. No new database/service or production activation.

Global constraints: no merge/deploy; default off; master allowlist; historic rows enrolled only on an explicit new outcome or a new assignment after activation; preserve auth/payroll/reports/integrations/header. Company time is Europe/Moscow. Existing schedule time_slot duration must be preserved.

## Tasks
- [x] 1. SQL contract tests, additive migration, atomic RPC, immutable event receipts, revision checks, pilot config and assignment tracking. Reuse existing contact journal and task table. Verify missing fields, idempotency, permissions, outdated writes, reports and completion independence.
- [x] 2. Working-minute due dates using staff_schedule, explicit company window and observed current visit; server tick independent of push; versioned reminders, capped repeats, escalation and reassignment. Verify boundaries, no historical backfill, stop on completion/cancel and feature-off.
- [x] 3. Extend existing contact form with required next contact or visit, preserve draft on error/reload and receipt ID on retry. Extend existing contact summary and Control categories; show future vs overdue. Verify mobile, network, attempt vs success, existing schedule/report regressions.
- [x] 4. Run required checks, independent branch review, commit/push and PR; provide isolated fixture Preview if supported. Record deployment prerequisites and unverified production boundaries.

## Review focus
1. Old clients must not bypass new requirements for enrolled/pilot masters.
2. Lost response/retry after a newer agreement must not revive old obligations.
3. Sender must recheck feature flags, assignment and current event before push.
4. Manager visibility cannot depend on push or on loading only today's orders.
5. Concurrent ticks and assignments must share order→task lock order.

## Decisions
- No activation defaults for company hours or manager; enabling rejects missing configuration.
- First contact default 60 working minutes. Escalation default 120 working minutes (pilot proposal, must be approved). One reminder per recipient/version by default; configurable cap 0–1. No uncertain push retry.
- History never trimmed for pilot contact events. Existing legacy behavior retained when disabled.
- Implementation runs inline; one independent review after checks.

## Review resolutions
- Independent backend review: corrected queue starvation beyond 200; disabled legacy saves now invalidate old tasks and retain full journal/immutable receipts; explicit shifts override fallback; 24:00/spaced slot duration preserved; existing transferred obligations continue outside enrollment allowlist.
- Independent frontend review: fixed stale contact summary repaint, home counters for automatic obligations, and loading missing orders before opening the result action. Added targeted regressions. Conflict/draft flow independently exercised at 320px in a Los Angeles browser.
- Workstation UI tests now deny unmocked external network at browser launch and context level; fixture tests prove isolation.

Completed as PR #295. Final code CI run 38777540457 succeeded; actual counts and explicit skips are in verification.md. Hosted staging was unavailable; three fixture scenarios are captured in preview/. Production activation remains a separate user decision.
