# Rejected report guidance

Production's existing order trigger clears report attachments and restarts master workflow when a pending report is rejected. The rejection status and reviewer comment remain. UI rejection predicates must therefore depend on `report_review_status`, not the presence of uploaded files.

Master home, focus and workflow panels now retain the reason after the trigger reset. The active panel shows it both with and without an agreed schedule. Guidance explains that the stages must be repeated before another report. Existing action permissions and stage ordering are unchanged. Legacy rejected reports that still contain files keep their existing correction label.

Validation: 199 server tests and nine targeted UI tests, including production-shaped null report pointers, 360px/1600px layouts, visible escaped reviewer comment, disabled report until repeated departure/start, and unscheduled agreement flow. Full exact-head CI remains required before merge. No backend, SQL, historical payout or auth changes.

Open older master workflow PRs #115/#129/#175/#177/#179/#180 overlap these files and require separate rebase/review. None was merged or closed.
