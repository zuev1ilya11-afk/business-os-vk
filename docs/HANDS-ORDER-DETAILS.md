# Compact master order and Hands comments

The master modal retains the current dark Business OS surface, source payroll
helpers, authenticated workflow actions and report form. The client call and
mandatory contact confirmations are together. Only two work lines are initially
shown; native details disclose all exact names/quantities. Comments have a visible
preview and full expansion. The next workflow action remains the only active step.
The separate next-action, duplicate date/route and bottom contact blocks are gone.
Full non-Hands cost and payout are in the header; their unchanged calculation is
expandable. Hands total cost remains hidden, including owner master preview.

## Verified upstream contract and limitation

On 2026-10-01 an authenticated read-only GET to the existing specialist
`/orders/?status=ACTIVE&per_page=1&page=1` returned 200. Only field names and types
were captured, never client values or credentials. The response envelope is
`orders,page,per_page,pages,total`. Order fields include `id,client_name,
client_phones,address,directions,title,price,creation_time,work_time,specialist,
status,payment_status,shop_name,comment,works,files`. Work entries contain string
`name,description,quantity,price,unit`. A detail GET for that returned order at
`/orders/{id}/` returned 404.

**That observed feed exposes no structured apartment, floor or entrance.**
This release therefore supports persistent, authorized manual apartment entry;
it does not claim automatic apartment import and does not guess a flat from an
address. A confirmed upstream field/endpoint is still required for that part.
The test fixture contains synthetic values under observed keys, not a fabricated
apartment contract. Existing work quantities are preserved on both repo import paths.

A temporary extension of the existing machine-only worker's read-only probe
returned schema types for this check. The original worker source and deno.json
were restored byte-for-byte (worker v6); report delivery behavior was unchanged.
No reports, files, client calls or test orders were sent to production.

## Persistence and manual edits

Migration `20261001193413_master_hands_details.sql` adds nullable `apartment`,
`hands_comment_source` and an empty-by-default per-field `hands_detail_overrides`
object. Existing order RLS and signed-session roles remain unchanged. The real
mini-app API checks owner/manager/dispatcher before accepting either field;
master workflow/report APIs do not accept those fields. Text length/type validation
runs on the server. Existing API callers may omit both fields.

An edit, including explicit empty text, freezes only that field. A new edit form
omits untouched fields, avoiding stale form values replacing newer Hands updates.
Manual override flags cannot be reset through client-supplied database flags.
Hands comments retain the last nonempty comment/directions/shop/payment components:
missing, null or temporarily empty upstream components do not erase local content.

Legacy comments have no provenance. At the first observed refresh, a nonempty
comment unequal to the known imported representation is preserved conservatively
as a local override. We cannot safely label that text as an old import or a past
manual edit. Empty legacy comments are filled and matching imports track Hands.
There is no bulk SQL backfill. Previously imported orders are handled by ordinary
bounded sync/webhook deliveries. Accepted reports may receive descriptive fields
only; their receipt/status/financial snapshots remain untouched. Updates compare
status, review status and updated_at to reject concurrent manual changes.

## Backend release boundary

Never replace live `hands-api` with the repository's older full handler. Export
fresh v8 privately and use `scripts/patch-live-hands-details.cjs`: it checks the
exact reviewed import fixture, changes only that routine, and adds a relative
shared helper import. The webhook, authentication and private configuration remain
byte-identical. Deploy that private result including `hands-details.ts` and retain
verify_jwt=false (existing custom authentication). Deploy mini-app-api and
order-lifecycle-api with their shared helper and existing dependency files.
Apply the backwards-compatible migration before the updated handlers.

Targeted tests exercise all three import implementations, partial source responses,
independent edits, clearing, legacy/accepted rows, no duplicates, racing edits and
real role gates. Playwright uses real Edge handlers with synthetic in-memory records
and provider responses, not production client orders. Required CI additionally runs
the migration twice and validates constraints in disposable PostgreSQL.
