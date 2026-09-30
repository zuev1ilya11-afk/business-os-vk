# Archive filenames must match declared file types

The read-only production archive check on 2026-09-30 found an act named
“Акт выполненных работ.pdf” with Drive MIME type `image/jpeg`. The Edge Function
passed hardcoded `act.pdf`, `measurement.pdf` and `photo_N.jpg` names to the Apps
Script bridge regardless of the downloaded Storage object's Content-Type. This
can cause downloaded images to be opened as PDFs by local applications.

The archiver now chooses the suffix from a small explicit map of PDF and common
image MIME types, ignoring Content-Type parameters/case for that lookup. It
preserves the original MIME header and file bytes. Unknown types retain the
existing fallback filename. This does not validate or transcode file contents.

The change applies only to subsequent archive writes. Existing archive receipts
still return without a network write; historical files are not renamed or
rewritten. Report snapshots, authentication, size limits, network deadlines,
approval and payroll behavior are unchanged. No database migration is needed.

`tests/archive-file-types.test.cjs` exercises the real archiver through the Drive
request, checking act, measurement and photo names and exact binary round trips.
Four initial cases failed before the fix. Attachment-boundary and archive
deadline tests cover the unchanged authorization/network/write protections.
