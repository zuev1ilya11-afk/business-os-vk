# Astra 6 — Business OS repository navigation

Purpose: a compact map for Astra 6 and future maintainers. Update this file when a change materially alters startup, authentication, API routing, deployment, or critical tests.

## Current production path

- `index.html` — application entrypoint and script order.
- `network-direct-v86.js` — network resilience layer for API requests. It keeps the Netlify gateway primary, applies a short network deadline, and falls back directly to Supabase Functions only for retryable network failures.
- `config.js` — legacy/runtime URL normalization and gateway routing. **Keep `network-direct-v86.js` loaded before `config.js`.**
- `vk-init.js` — asynchronous VK Bridge bootstrap. Current source order: unpkg -> jsDelivr -> Netlify fallback. Publishes `window.BOS_VK_BRIDGE_READY` when bridge loading completes.
- `mandatory-auth-v29.js` — mandatory authentication flow. It first uses signed VK launch params already present in URL/hash; if they are absent it waits for VK Bridge and requests launch params.
- `pwa-register.js` / `sw.js` — PWA registration and cache/network behavior.

## No-VPN change set (PR #55)

Goal: remove a hard startup/runtime dependency on `netlify.app`, because that host may be unreachable on some networks without VPN.

Important invariants:

1. The gateway remains the preferred API path.
2. Direct Supabase fallback is allowed only for network-type failures/timeouts. **Do not retry a valid HTTP 4xx/5xx response against the direct backend.**
3. Direct fallback must use the original/native `fetch`, otherwise `config.js` can rewrite the fallback back to the gateway and create a loop.
4. VK Bridge must not be a blocking external script in `index.html`.
5. Authentication must tolerate the bridge being loaded asynchronously. Do not remove the `BOS_VK_BRIDGE_READY` wait without replacing it with an equivalent readiness mechanism.

## Tests covering this area

- `tests/no-vpn-network.spec.js` — startup/network ordering and removal of the blocking Netlify bridge script.
- `tests/api-network-fallback.spec.js` — gateway timeout/offline fallback and no fallback for valid HTTP failures.
- `tests/network-vpn-resilience.spec.js` — resilient bridge sources and API behavior under restricted-network conditions.
- `tests/full-stack-audit.spec.js` — total-outage scenarios must stall/mock both the gateway and direct Supabase fallback.

When updating tests, remember that the browser may contact either the gateway or direct Supabase after a retryable network failure. A test that intentionally simulates a total outage must intercept both paths.

## Change discipline

- Work from current `main`; do not restore old application versions.
- Preserve working production behavior and make small reversible changes.
- Before merging, require both server regression and UI smoke checks to be green unless a failing test is conclusively proven unrelated and separately validated.
- Prefer fixing a stale test when the product behavior is demonstrably correct; do not change working product code just to satisfy an outdated assertion.
