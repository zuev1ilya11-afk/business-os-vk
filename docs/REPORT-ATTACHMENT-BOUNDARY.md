# Report attachment boundary

New URL-based finalization accepts only HTTPS signed Storage URLs from the
configured Supabase origin and the `business-os-vk-files/orders/<order>/<token>/`
path. Credentials, fragments, other origins/buckets/orders/tokens, traversal and
nested paths are refused. The archiver repeats the validation before fetching,
including for historical rows. The signed token is verified by Storage when
reading the object, not trusted as an authorization claim in application code.

Attachment reads reject redirects and are aborted after 15 seconds. The actual
stream, including responses without Content-Length, is limited to 10 MiB per
file and 25 MiB per report. An advertised oversized body is refused early and
the request is aborted. Existing bucket rules are unchanged. Read-only inventory
on 29 September found 103 referenced objects: all matched their order/token;
all sizes were present, maximum file 156375 bytes and report 301360 bytes.

The existing multipart `report-file-upload` production source is now tracked.
It refuses uploads after submission/closure and creates unique objects with
`upsert:false`, matching report-api. Missing auth configuration fails closed.
An upload that was already in flight may leave an unreferenced object, but it
cannot replace an existing attachment.

Archive metadata compares the original report version at write time. A changed
report before the bridge call is refused; a race during the bridge call cannot
attach stale metadata to the newer report. An already archived receipt performs
no external rewrite. This is not a distributed transaction: Google Drive may
contain an orphan/stale external write if a report changes during the bridge
call. No destructive archive cleanup or claim of exactly-once delivery is added.

Document links in the review/master views omit executable URL schemes. Existing
HTTP/HTTPS links remain readable; finalization's server boundary is stricter.

Deployment includes the already tracked main `order_no/order_no_sign` fields,
which were absent in live drive-archive-api v11. The original archive signature
is preserved and tested; the previous Apps Script implementation ignores the
additional fields, while the newer tracked bridge validates their own signature.
No Apps Script deployment or change of archive folder layout is part of this PR.

No migrations, RLS changes, historical rewrites or payroll changes are included.
Tests use real Edge handlers and bounded mocked streams, not internal-network
requests or mutations of customer orders.
