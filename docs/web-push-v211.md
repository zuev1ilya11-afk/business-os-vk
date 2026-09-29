# Phone notifications (issue #211)

The existing PWA receives Web Push through its existing service worker; no APK, second project or auth replacement is introduced. A consented subscription belongs to the verified BOS actor, not an owner preview persona. No real-device delivery is established by a provider HTTP 2xx or mocked browser test.

## Runtime boundaries

- `web-push-v211.js`: opt-in settings from the profile, permission gesture, device management, test, revocation outbox and safe order opening.
- `sw.js`: encrypted-push reception, binding check, display and safe same-origin navigation; existing build integrity/cache lifecycle preserved.
- `push-api`: signed BOS session + active staff for subscribe/status/test, separate random Vault-backed worker bearer, revocation-only device capability for logout/offline cleanup. Provider endpoint allowlist, encrypted `aes128gcm`, no redirects.
- `20260929163737_web_push_v211.sql`: service-only RLS device/queue tables, disabled runtime, additive AFTER order trigger, per-subscription binding, five-attempt lease queue, stale-access recheck and maintenance. Existing payroll/order guards are unchanged. No historical backfill.
- Public RPCs are not browser APIs: EXECUTE revoked from PUBLIC/anon/authenticated. `bos_push_runtime` and VAPID initialization are server-only and must never be exposed by a generic RPC proxy.
- The existing network layer retries explicit gateway service-miss responses against the next candidate, including direct Supabase. Push-specific regressions cover signed-header preservation and no replay of an uncertain test request. Updating live gateway allowlists is optional; no existing gateway is replaced.

The supported event set is assignment, removal, time change, cancellation, rejected report, new order and report awaiting review. Operations recipients follow the current owner/manager/dispatcher access. Removed-master notifications omit the order ID. All messages omit customer names, addresses, phones, report text and money. An order is reloaded under the current session before opening.

## Deployment order

1. Pass Node, browser, frozen Deno dependency and disposable PostgreSQL checks on the exact PR head. Keep mandatory PR and smoke protections.
2. Apply the additive migration (runtime is disabled). Deploy only the new `push-api` with its exact files, `deno.json` and lockfile. `verify_jwt=false` is intentional because the body verifies custom BOS sessions, a worker secret or a revocation-only capability; no launch-only auth is accepted.
3. Verify the existing gateway service-miss fallback to the new direct Edge endpoint. Do not replace live gateways or handlers with older repository exports. Allowlist updates may be deployed separately.
4. Apply `supabase/push-activation.sql` only after the new handler is deployed. It installs pg_net, schedules minute-based queue recovery, enables the runtime, and makes an authenticated wake-up without exporting the secret. VAPID keys are generated in the handler and the private key stays in Vault. Check worker HTTP response, advisors and unauthenticated rejection. Never print worker/VAPID private keys, device endpoints or auth keys.
5. Merge/deploy the tested frontend through the normal pipeline. Confirm the generated BUILD_ID and assets on the actual production origin.
6. On a physical phone, update the PWA, open profile → notifications → enable → allow → test. Check closed app/locked screen over Wi-Fi and mobile data without VPN. Also verify real assignment/cancel/rejection and tap-to-order. Phone permission cannot be granted remotely.

Delivery is best effort: network/OS restrictions and offline state can delay it. Queue retries expire after 15 minutes (test after five). A provider 2xx means accepted, not displayed. Device subscriptions expire after 30 days and are renewed only while a previously consented signed-in account is active. iPhone requires a supported Home Screen web app (Web Push introduced in iOS 16.4); embedded VK browsers are not assumed to support the PWA channel. No silent permissions, open-tab polling or Telegram substitution.

## Rollback

First set `bos_push_private.runtime.enabled=false`; optionally unschedule only the named `bos-web-push-recovery` cron job. The additive order trigger then returns immediately. Do not drop business tables, rotate existing account passwords, remove historical orders or change payroll/auth. Restore the preceding frontend through the normal reviewed build path. Subscription records and Vault keys need not be deleted.

## Validation

`npm run build:check`; `npm run test:server`; `npm run test:ui`; `bash scripts/test-push.sh` against an explicit disposable PostgreSQL only. SQL fixture models Vault/HTTP boundaries, not production encryption or actual phone delivery. Node tests exercise actual handler code with a controlled provider boundary. Browser tests mock browser permission/push transport, not application auth or navigation.

Primary references: https://web.dev/articles/push-notifications-overview ; https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ ; https://github.com/web-push-libs/web-push ; https://supabase.com/docs/guides/functions/schedule-functions .
