# Order control — first increment

Baseline: main 5d0aa54188ea5c28ec717bcc7787eb07b21d916e (PR #242).

## Scope

The operations home screen receives a single "Требует внимания" section above the metrics. While the new panel is present it replaces the duplicate owner/manager problem list. Existing orders, calendar, report review, completed-order corrections, and dispatcher attention filters remain intact. No additional navigation tab is introduced.

The read-only classifier groups existing orders by internal identity and lists: requested transfer, past visit day, missing master/date/time, nearby visits without a recorded call/agreement, pending reports, rejected reports, and recorded unfinished work on active orders. It uses canonical master_called_at/master_agreed_at and report_uploaded_at/report_review_status. It does not invent a master assignment-acceptance field. Dates use Europe/Moscow, including midnight and resume. Historical completed/cancelled orders do not generate missing-report alerts; their existing correction tools remain available. Pending/rejected reports replace obsolete visit-preparation warnings.

Cards show the next acting role and the recorded visit date. These are NOT newly assigned personal tasks or SLA deadlines. Counts are unique orders; one order may belong to several filters. The first 12 cards have a show-more control. Text is escaped; actions reopen the existing order/review UI. Role authorization remains server-authoritative. Masters, master preview, and logged-out views do not display the panel.

The panel makes no network calls, sends no messages, creates no orders, and changes no payroll/authentication/backend schema. It reuses the data already loaded by the application, preserves idle DOM nodes, and re-evaluates after rendering/resume/Moscow midnight. With the module unavailable, the original home/problem section is unchanged.

## Deliberately not activated

- Persistent personal task ownership, explicit response deadlines, reminders/escalation.
- A shared Hands delivery exception feed (the queue stays private; no per-card polling).
- Avito AI responses, provider messages, automatic reassignment.
- Physical-device push verification or production report testing with fabricated orders.

These remain subsequent increments, not claimed as completed by this PR.

## Production checkpoint, 2026-10-01 (read-only)

Hands runtime and its minutely recovery cron are enabled; there were 0 delivery records. First real accepted-report delivery remains unproven. Existing historical accepted reports were not requeued.

Push runtime is enabled and configured. There are 3 stored subscriptions, 2 active; 18 business-event deliveries have a provider HTTP 201. This proves provider acceptance, not visible delivery to a physical phone. One prior test endpoint returned 410.

Netlify still publishes deployment 6abd5f7eb4db33d59e5f7c58, titled Avito workspace build 22855cef36d429638e95. The last recorded newer attempt was rejected for account credit usage. No alternate site/quota workaround was used. Baseline main/Pages release notes refer to build 70d593498ca8698ce7a2. A current public asset hash comparison was not possible from this execution environment.

## Validation

18 deterministic Node cases cover Moscow midnight, date validity, grouping, ordering, historical exclusions, report precedence, agreement stages, literal reasons, unfinished-work preservation and data immutability. All 363 server cases passed locally; the canonical build/check gives BUILD_ID a3669d0760bd6b50b1c5.

Seven new browser cases cover operations roles at 320/390/1280px, top placement without a duplicate problem list, filters, order opening, escaping, refresh/idle identity, pagination, master/preview/logout exclusion. The existing dispatcher attention test is included in targeted CI. Screenshots are captured in CI because this local Chromium environment rejects loopback navigation with ERR_BLOCKED_BY_ADMINISTRATOR; no bypass was attempted. The complete unchanged CI suite remains the release gate. No production customer data is used by these tests.
