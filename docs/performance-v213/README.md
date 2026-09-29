# Startup/network correction, 2026-09-29

Baseline: production `e102027e6e80ff4c177547d0b2bc8075e6208c22` (PR #212).

## Findings and changes

- `app-public.js` started an anonymous bootstrap before the active auth module. `reclamation-status-v18.js` also scheduled a redundant full bootstrap at 700 ms. The ordinary auth bootstrap was already reused, but these independent callers bypassed that optimization. Remove the production anonymous init and legacy timer; retain the existing explicit local development behavior and reclamation normalization. Initialize the live-refresh clock when auth finishes, preventing an immediate pageshow/focus refresh.
- `pwa-register.js` awaited 21 sequential role-script downloads for an owner (12 dispatcher and 9 master). Start their downloads together using ordered dynamic scripts (`async=false`), preserving evaluation order and role selection. Do not insert four scripts already present in HTML twice.
- A fast bootstrap could unlock the application before the late role loader existed. Wait for deferred entrypoint completion when that loader is not yet present. The initial loading shell stays visible, and the final screen has all required role modules.
- `index.html` had 96 parser-blocking external scripts (654,883 raw bytes, 239,412 bytes when individually gzipped at baseline). Use `defer` without changing their order. This is not a bundle rewrite; the large number of legacy files remains a limitation.
- `sw.js` always fetched navigation HTML before consulting the verified installed cache, with no application navigation timeout. Return the installed digest-verified shell immediately. The existing worker update checks, BUILD_ID/digest checks, waiting update consent, prior-build retention, offline asset cache and push binding remain intact.
- `network-direct-v86.js` normally ended the route timeout after headers. A stalled bootstrap JSON body could consume the outer 20-second deadline without trying another route. Read API responses inside the route deadline; reset its inactivity timer on body progress, cap ordinary progress at 15 seconds per attempt, and preserve caller cancellation. Password routes retain their existing total deadlines/header fast path. Existing write replay restrictions, long report-review deadline and excluded Avito transport remain intact. Reset route preference on online/connection-change events.
- `mandatory-auth-v29.js` treated temporary saved-session validation failure as a reason to show the password form. Preserve the stored session, show Retry, coalesce startup retries, and resume automatically on online. The server still validates the session and role; HTTP 401 still clears it. Existing live data refresh also reacts to online without replacing unsaved edits.

The active browser flow uses a custom signed BOS session and Edge APIs, not a browser Supabase Auth SDK. No added `getUser`, Supabase `getSession`, or refresh-token calls. No API/schema/RLS/payroll/business-rule changes.

## Before / after

Cold Chromium, Pixel 7 emulation, gzip static assets served by the same local HTTP/1.1 server, same fixture API. One sample per profile, not a percentile or an operator measurement. Timings are milliseconds from navigation until auth and all modules required for the role are ready. `gateMs` is recorded separately because baseline sometimes revealed an incomplete UI early.

| Profile | Network model | Before fully ready | After fully ready | Bootstrap calls |
| --- | --- | ---: | ---: | --- |
| Fast 4G | 60 ms latency, 4 Mbps down / 3 Mbps up | 3482 | 2202 | 4 → 1 |
| Slow 4G | 150 ms latency, 1.6 Mbps down / 750 Kbps up | 8157 | 5168 | 4 → 1 |
| High latency | 600 ms latency, 4 Mbps down / 1 Mbps up | 28374 | 17256 | 4 → 1 |

First contentful paint: 380 → 460 ms, 636 → 632 ms, 2024 → 2048 ms respectively. The improvement is in usable readiness, not a claimed first-paint improvement. High-latency cold load remains slow. HTTP/1.1 connection queuing is represented; these measurements are not evidence of production HTTP/2 or HTTP/3 behavior.

`before.json` / `after.json` contain the per-resource waterfall (start, duration, TTFB, encoded body bytes, status, protocol) and navigation timing. Run:

```sh
node scripts/measure-startup.cjs /path/to/checkout /tmp/startup.json
```

An additional isolated 100ms-per-resource fixture initially measured owner readiness 2946ms, dispatcher 2024ms and master 1686ms. This is diagnostic evidence for the serial dependency chain, not a real carrier benchmark.

## Production evidence and limits

- Existing production login screen opened successfully in the cloud Chrome browser. Baseline GitHub Pages deployment and complete UI smoke were successful for `e102027`.
- Read-only production PostgreSQL statistics showed common orders SELECT patterns averaging 1.30–4.17 ms, with observed maxima 22.51–388.90 ms. This excludes Edge startup, proxy overhead, payload transfer, DNS/TLS and the user's network; it does not prove every production request is fast.
- Shell outbound access to the production site is restricted/timeouts in this environment. The cloud browser exposes visible UI but not Resource Timing in its read-only page scope. Production DNS/connect/TLS/TTFB, provider-specific IPv4/IPv6/dual-stack behavior, packet loss, MTU, DNS resolvers and real VPN switching could not be measured reliably here.
- Automated coverage uses Chromium desktop/Pixel 7 and iPhone viewport emulation, synthetic route failures/timeouts/body stalls/progress, offline/online, saved-session recovery and a real local service worker cache/update lifecycle. iPhone viewport emulation is not Safari/WebKit. Physical Android manufacturers, mobile carriers, installed OS PWA launches, real VPN and physical iOS are unverified.
- Cached PWA navigation is tested against an HTTP server that never responds to navigation; cached shell opens without issuing that request. Offline reload and multi-tab build consent/rollback protection are separately covered.
- There is no promise of universal connectivity: all known routes being unreachable still yields a retryable error. A true first-ever offline visit has no cached shell. Existing saved data is not made available offline by this change.

## Validation

241 server tests passed. Targeted browser tests cover password route fallback, signed session recovery, owner/dispatcher/master startup, no anonymous bootstrap, no duplicate eager scripts, parallel role downloads, delayed loader, stalled/slow response bodies, online route reset, offline cached navigation, update consent and logout/late-renewal races. The repository's complete protected `smoke` CI is required before merge.
