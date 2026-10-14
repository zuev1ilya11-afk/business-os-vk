# Shared help editor implementation

Base: cf73b2bfcc91f6ff5f88b63f4f08b3bc701465e6. Branch: feat/shared-help-editor.
The user's eight-part specification in this task is authoritative. No production deployment, payroll/order/report/schedule/auth changes, unrelated audit or redesign.

Architecture: extend authenticated master-memo-api with help_list/help_save; reuse its verified active business_staff actor. A separate master_help_materials table stores four material kinds as validated JSON with stable IDs and an integer version. Original memo/file operations are unchanged. SQL schema and seed are explicitly applied to the RU PostgreSQL instance only after approval; no cloud Supabase deployment. A native editor inside the existing help dialog reads the same server rows as the master view. Same-origin API only.

Tasks (inline execution):
1. Baseline and content: preserve all existing fields/images/branches, remove two requested FAQ objects, give materials and steps permanent IDs. Tests compare all other content to the baseline.
2. Server: validate four types; owner/manager only write, other active roles read; insert IDs enforce retry safety, CAS update version detects conflicts; protect fixed image/branch fields. Idempotent insert-only initial seed. New table with RLS, service_role access only. Test actual handler with signed sessions, reject spoofing, duplicates, invalid values, concurrency and reseed.
3. UI: fetch at each open, server capabilities only, profile entry for owner/manager, management/add/edit in existing cards, normal text/list fields, preserve illustrations. Pending-save lock, server-confirmed success, retained drafts on errors, conflict disclosure, dirty close/back/escape guard, readable offline cache scoped to authenticated user. Tests exercise forms and shared state.
4. Verify: targeted existing help/memo/navigation tests plus editor API/UI and SQL persistence. Check short/narrow viewport, escaping and safe copy. Fresh independent code review after implementation. Build and build:check.
5. Preview: use existing isolated preview, never connect fixtures or test writes to production. A mock/static preview cannot satisfy server persistence. If a real isolated RU runtime/credentials are unavailable, clearly report that gate, preserve runnable source and test evidence and do not claim a production-backed Preview.

Review focus: lost save response + retry; editor opened before a role/session change; stale caches resurrecting removed FAQ; simultaneous writes on different devices; closing/back/keyboard while saving or dirty.

Progress:
- Current local repositories clean; latest main fetched and worktree created. No unpublished changes overwritten.
- Production implementation lives on RU edge/PostgreSQL. Repository source alone cannot certify the live backend checksum. No authenticated RU execution channel available yet.
