# Hands: incident cause and guarded recovery

## Confirmed cause, October 9

The owner confirmed that the provider webhook destination ended at
https://139.100.237.167/functions/v1/hands-api, without a token query parameter.
An external empty POST to that exact route returned HTTP 401, with
Доступ не подтверждён. The reviewed private v11 handler routes a request to
webhook processing only when token is present; otherwise it requires a user
session. The provider screenshot showed two failed deliveries, 11 attempts each.

The owner added the configured webhook token to the destination and confirmed
saving it at approximately 11:42 Moscow. The token had previously been copied
from the provider's signing-secret field into the server's WEBHOOK_TOKEN setting.
No secret is included here. Saving the URL is not proof of successful delivery.

At the 08:21 UTC server check: 23 ACTIVE provider orders, 111 target Hands rows,
two missing ACTIVE candidates, zero duplicate groups. The two candidates were
also absent from the old source database. This is not a complete comparison of
the migration window, completed/cancelled records or source-only events.

## Why a recovery patch is needed

Private v11 reuses its update-capable importer for CREATED deliveries. A repeat
with a different delivery ID can overwrite an existing order's assignment,
schedule and other fields. The regression was reproduced before the patch.

The patch changes only two exact, hash-verified functions in the private source:

- CREATED intake skips existing canonical and legacy IDs before any update.
- A concurrent unique conflict is reread and skipped without overwriting it.
- Normal manual synchronization retains its previous behavior.
- A recovery request may provide an explicit validated UTC creation timestamp.
  Mapping of contacts, address, work, comments, status and staff is reused.
- A receipt-write failure no longer returns false success.

The public tracked full handler is older and must not replace the live private
handler. No schema, roles, payroll, user auth, reports or UI files are changed.

## Commands on the RU host

Use the exact reviewed version of scripts/ru-hands-insert-only.py.

    python3 ru-hands-insert-only.py --check
    python3 ru-hands-insert-only.py --apply
    python3 ru-hands-insert-only.py --recover --timezone Europe/Moscow

The timezone argument is permitted only after confirming the timezone of the
provider's naive creation_time. Omit it to fail closed for naive values.
The screenshot's display time alone does not prove the API timezone.

--check validates the actual release/DB route, external-ID unique index and
public HTTPS acceptance of the active server token using an empty request
without a delivery header; it cannot create a client order.

--apply backs up exact source/bundle, reproduces the current bundle with the
same local image, disconnects the compiler network, builds the patch, checks an
isolated API with dummy DB credentials, rechecks files and configuration, then
restarts the existing edge. Normal failures restore the original files and
restart the previous API. It does not import orders or change the provider URL.

--recover requires the installed patch and matching configuration, fully reads
the bounded ACTIVE feed with retries, rechecks canonical/legacy IDs, validates
all dates before importing, and sends only missing real payloads through the
existing webhook/importer. Repeated sends use stable delivery IDs. Each recovered
payload is immediately replayed once and must receive a duplicate acknowledgement.
No fabricated
clients or direct SQL inserts are used. Payloads remain in memory. Each attempt
has a separate mode-0600 journal under a mode-0700 directory.

The final counters distinguish acknowledged responses from candidates confirmed
present: a lost successful response followed by a duplicate acknowledgement does
not falsely count as an acknowledged creation. The final comparison reports
remaining missing IDs and duplicate groups. health.json records the last
successful ACTIVE reconciliation.

## Rollback and remaining gates

    python3 ru-hands-insert-only.py --rollback

Rollback checks the exact saved runtime, journal, backups and unchanged unrelated
files; it also supports a stopped edge. It restores only the two runtime files.
It never rolls the database back or deletes recovered orders. A conflicting
deployment stops the operation for review.

Production deployment/import, the provider's first real post-fix delivery,
dispatcher display, complete historical reconciliation and automatic scheduling
are still pending. No successful production recovery is claimed by this PR.
