# Order control v2 — explicit assignments and deadlines

Extends v1 without changing order/payroll values. An operations user chooses an active employee, a future Moscow deadline (up to 90 days), and optionally one push reminder for a specific current issue. No automatic assignment, historical backfill, escalation, client message, or provider subscription is created.

Assignments live in a closed database schema, not localStorage. Existing signed-session push-api provides the service-only list/save/clear boundary. Masters can read only their tasks and cannot write assignments; a master can be assigned only a contact/correction issue on their current order. Operations roles receive only minimal staff names and push availability, never device credentials.

Updates lock order then task and require an expected revision. Identical retries retain the same reminder event. Resolving an issue closes its task through an additive AFTER UPDATE trigger or the minute worker. A later recurrence does not reopen the old assignment. Explicit cancellation, reassignment, or deadline changes invalidate the old pending reminder.

The existing push transport is reused. New control reminders get one network attempt per enrolled device and explicit task revision. An uncertain response or abandoned lease is not blindly retried; the in-app task remains visible and the result is marked unconfirmed. Other business-event retries are unchanged. This trades automatic recovery of one reminder for avoiding duplicate sends; it does not promise physical-phone receipt. Deadline checks are minutely, not second-accurate. Devices disconnected beyond the 15-minute delivery lifetime can miss the push. Tasks without active subscriptions can wait up to 24 hours after their deadline, then require an explicit new future deadline to notify.

The UI refreshes task metadata at most once a minute while the home screen is visible, on explicit refresh and after changes. It requests current assignment metadata separately before editing, keeps input on a conflict, and drops state/dialogs on logout or account changes. Master task display is read-only. Lists expose a visible 500-item truncation notice rather than claiming to show everything.

## Safe release order

Run PostgreSQL contracts against a disposable database (including existing sender tests against the extended RPCs), frozen sender type checks, Node boundaries and UI scenarios. Apply the additive migration with reminder runtime disabled. Deploy the tested push-api without changing its custom authentication or VAPID configuration. After green complete PR CI, merge and verify canonical public frontend assets. Enable the new minute job/runtime only after deployment checks; no customer test task is required.

Disable reminders by setting bos_control_private.runtime.enabled=false and unscheduling only bos-order-control-reminders. The v1 attention list and ordinary push remain intact. No rollback should delete task history.
