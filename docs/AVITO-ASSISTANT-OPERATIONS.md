# Avito assistant — operations
This first release handles text in new dialogs created after activation. It gathers a confirmed request; it does not make a binding price quote or reserve a master.

## Behavior
- Region and all 37 starting prices come from `_shared/avito-price-catalog.json`, the same data shown in the app.
- OpenAI extracts facts with exact incoming-message evidence and a strict JSON schema. Sending text, service prices, confirmation and order writes are controlled by code. No model tools or arbitrary replies.
- A standalone customer confirmation is valid only after the actual last assistant summary. Corrections cause a new summary. A human reply pauses the dialog.
- New confirmed requests are unassigned, status Новая, amount/payouts 0. The starting tariff, conditions and desired time remain in the comment; operations staff agree the actual total and visit time. Existing formulas, appointments and manual orders are untouched.
- The existing Avito chat unique key deduplicates manual and automated creation.
- Durable outbox reserves each input once before sending. Crashes/timeouts stay uncertain and require an operator, never an automatic replay.
- The daily limit is 200 extraction calls and 200 messages; each dialog allows at most 20 messages.
- Old dialogs, attachments, long histories, ambiguous tariffs and unsupported requests stay with operators. Handoffs are kept in private conversation state and in the Avito conversation. A dedicated handoff push notification/UI is not part of this release.

## Setup
1. Existing CI runs frozen Deno type checks, real PostgreSQL permission/idempotency/lease tests and mocked provider tests. No production messages are sent by tests.
2. Apply `supabase/avito-assistant-setup.sql` as an additive named Supabase migration, initially disabled. The execution workspace is unavailable, so the SQL definition is committed as an operational setup file; do not fabricate a timestamped CLI migration filename.
3. Deploy `avito-assistant-api` with index.ts, core.ts, catalog JSON, deno.json and frozen deno.lock. JWT gateway verification is false because the handler validates a dedicated server worker credential. App sessions and anonymous callers cannot use this endpoint.
4. Set Supabase secret `OPENAI_API_KEY`. Optional `AVITO_AI_MODEL` defaults to pinned `gpt-4.1-mini-2025-04-14`. Existing Avito server credentials are reused. Keys never go to chat, Git or browser.
5. Set private runtime worker_url to the project's HTTPS function URL. `SELECT bos_avito_private.kick(true)` performs a credential-presence probe without model calls, Avito messages or order writes. Read only runtime.health and redacted status — never worker_key.
6. Review a consenting live pilot before broad activation; mocked success and a presence probe do not establish live model access or delivery. Use an isolated test Avito account, or enable under operator observation for a new consenting conversation, then pause. Existing dialogs are excluded.
7. Activate with `supabase/avito-assistant-activation.sql`. The every-minute worker also scans older pages so the first page is not the only source.
8. Immediate stop: `UPDATE bos_avito_private.runtime SET enabled=false WHERE singleton;`

## Limits
- Starting prices do not establish units, travel fees, a minimum callout or materials inclusion. The assistant explicitly leaves these for agreement before work.
- Desired date/time is text, not a confirmed booking. No automated master assignment or calendar writes.
- The provider send API has no proven idempotency contract. An uncertain send is handed off even when that may mean a missing response.
- Polling and provider outages can delay intake. Operator replies are rechecked immediately before sending, but a last-millisecond concurrent provider write cannot be locked atomically.
- The model credential and a real consenting conversation are required for live verification. Until those gates are satisfied keep enabled=false.

## Official implementation references
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/models/gpt-4.1-mini
- https://supabase.com/docs/guides/functions/schedule-functions
