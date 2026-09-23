# Avito integration v2

## Current checkpoint

Based on main `6665eab7b704380dff2e01562f74580ae6bfdbc8` (PR #111).
Branch: `feat/avito-integration-v2`. No production deployment or activation in this PR.

The deployed `avito-api` v5 was inspected on 2026-09-23 and its existing authentication/connection contract was used as the base. The adapter had no Git source and no `chats` action. No connected account existed. The existing `avito_connections` table has RLS enabled, no client policies, and grants only to postgres/service_role. Existing order Avito columns and the unique `(external_source, external_id)` index are reused. No schema migration is required for this project.

## Implemented

- Frontend → existing Netlify gateway → `avito-api` → Avito. Gateway already allows the service.
- Owner-only connect/disconnect; owner, manager, dispatcher can use inbox. Masters and unauthenticated callers rejected server-side. Existing signed Business OS session/VK launch checks preserved.
- `AVITO_CLIENT_ID` and `AVITO_CLIENT_SECRET` read only from Supabase Secrets. Frontend never accepts or stores credentials. Connection table retains metadata and empty strings in legacy NOT NULL credential columns.
- Existing client_credentials flow retained for one owned account. Tokens are cached in server memory with expiry and coalesced refresh. GET retries an expired token once; mutation requests are never automatically replayed. This grant has no refresh_token or redirect URL. Multi-account authorization_code OAuth is not implemented.
- Chat list (100/page), messages (50/page), normalized client/item/time/unread information; send text (up to 1000 chars), mark read, manual refresh and visible-view polling every 30 seconds. Backoff on errors, pause in hidden tabs, stop on modal removal. Earlier history can be loaded.
- Inbox entry inside existing notification panel for operations roles. Unread count refers to loaded inbox pages only. No second notification framework or global background message poll.
- Create an order through existing `createOrder`, preserving validation and payroll. Chat/item IDs saved in existing fields; client ID and available incoming text in comment. Cross-dispatcher and concurrent creation deduplicated using `external_source=avito`, `external_id=avito_chat_<id>` and the existing unique index. Existing orders open instead of creating another draft. Order → chat button works with current management card.
- Sync updates only unread/time metadata on already-linked orders. It does not create orders or overwrite client, work, comment, money or status.
- Provider errors sanitized, 5-second provider request deadline, bounded rate-limit delay, 18-second UI deadline. Transport does not replay Avito calls through fallback. A send with uncertain outcome retains its draft and requires history refresh + explicit confirmation before repeating the same text in the same page session.

## Deployment / one external prerequisite

Owner action: put `AVITO_CLIENT_ID` and `AVITO_CLIENT_SECRET` for the intended Avito business account into Supabase project `obsropbslfwtanyspjbi` → Edge Functions → Secrets, with Messenger API access enabled. Do not paste secrets in chat, Git or frontend config.

After PR CI is green and code review/merge:

1. Deploy committed `supabase/functions/avito-api/index.ts` and the changed `mini-app-api/index.ts` to the same project. Use the existing deployment flow with JWT gateway verification disabled for custom Business OS auth; handlers enforce session/role checks themselves. Consult CLI `--help` if using CLI. Do not blindly deploy an older local mini-app-api over a newer production version.
2. Keep `BUSINESS_OS_CONFIG.AVITO_API_ENABLED` absent/false until both functions are deployed. This PR intentionally retains the existing manual/preintegration production mode. Then set it to true in `config.js`, update its HTML cache version and publish frontend. All new UI tests explicitly enable the flag.
3. As owner: Tools → Avito → Connect. Connect verifies both account identity and Messenger permissions before storing the active connection. No webhook registration is required.
4. Smoke-test with a consenting test conversation: list chats, inbound history, one outbound message and refresh, create one order, reopen chat, attempt duplicate creation as another dispatcher, disconnect and reconnect.

No account was connected and no real client message was sent during development. Official Avito documentation URLs were inaccessible in this runtime; provider endpoint paths inherit deployed v5 and require the live smoke above. Supabase secret handling follows https://supabase.com/docs/guides/functions/secrets.

## Limits / next stage

- This stage uses polling, not webhooks. Legacy query-secret webhook calls are no longer processed; there were no connected accounts at inspection. If rolling out to a different environment with an active old webhook, unsubscribe it first.
- No durable provider message outbox/idempotency key: protection covers duplicate submits, transport retries and uncertain resend confirmation in the current page. Simultaneous sends from different tabs/devices and a deliberate resend after reload are not deduplicated. Do not claim exactly-once delivery.
- No global notifications while inbox is closed, attachment upload, or account switching UI.
- Phone/city are filled only when provider supplies them; never inferred.
- Feature-off state, green mocks and CI do not demonstrate live Avito authorization or delivery.

## Focused verification

`node --test tests/avito-api.test.cjs`

`npx playwright test tests/avito-connected.spec.js tests/avito-preintegration.spec.js --workers=2`

Regression: `npm run test:server`; final UI gate: `npm run test:ui -- --workers=2`.

The frontend is a static published directory (`netlify.toml`), with no build command in package.json. Verify script syntax, linked local assets, server regressions and complete UI suite; do not invent a successful bundler build.

Do not re-audit unrelated screens, replay PR #89/#102 work, change payroll/auth architecture, or duplicate this adapter.
