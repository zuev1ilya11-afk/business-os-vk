# Duration-preserving reschedule

`order-meta-api.resolveReschedule` preserves the existing range duration when
`time_slot` is omitted, with a 60-minute fallback for a missing/invalid range.
An explicit range must start at `scheduled_time` and end later within the same
day. `24:00` is a valid end; an overflowing move is refused, not shortened.
The optional `expected_updated_at` protects a form or second write against
stale data. The write also compares the fetched status and update timestamp.

The reschedule modal uses the server's returned interval. A requested move in
the unified schedule for the same master resolves in one write. Reassignment
still uses the existing assignment and metadata endpoints: if confirmation
fails, the saved assignment/time remains visible with a partial-success message.
The second request carries the first write's version and interval. No claim of
cross-endpoint atomicity is made. Existing confirmation of overlap is retained.

Deployment: update order-meta-api before publishing the new client. The server
accepts older callers, and the new modal relies on server-preserved duration.
No payroll formulas, historical rows, schema, RLS or authentication changes.
Time interpretation across mobile/desktop/legacy data remains separate A06/A07.
