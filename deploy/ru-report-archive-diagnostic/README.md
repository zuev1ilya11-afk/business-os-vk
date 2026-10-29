# Report approval archive diagnosis

The UI reported an archive timeout before approval after the public origin moved
to `homemaster.qd.je`. The operator confirmed that the edge container's
`SUPABASE_URL` still names `https://139.100.237.167`. This is evidence of a retained
origin, not yet proof of the fault: internal routing may intercept these calls,
and attachment validation may intentionally retain the previous origin.

Run `python3 check.py` on the existing Docker host. No apply mode exists.
The script reads container metadata, hashes the deployed source files, reports
fixed routing indicators, reads the photo fix journal, and probes public API
routes from the host. It does not read business rows, send real report payloads,
approve reports, restart services, or change configuration. TLS verification is
enabled. Redirects are not followed. No credentials are sent by the probes.

The lifecycle probe uses `action: health`. The archive probe sends an empty JSON
object, which the reviewed handler rejects with `ORDER_ID_REQUIRED` before
authentication, database access, attachment reads, or Drive writes.

Limits: host probes do not establish reachability from inside an edge worker.
Source hashes do not establish bundle/source equivalence. This diagnostic does
not prove that an individual attachment exists or that Drive writes succeed.
Do not change SUPABASE_URL solely because it contains the old IP.

Validation: `python3 test_check.py -v` exercises allowed probe requests, rejects
business actions and arbitrary destinations, checks credential redaction, and
runs the whole diagnostic against a fake Docker inventory without mutations.
