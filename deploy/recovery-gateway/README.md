# Business OS temporary recovery gateway

Isolated alternate entry to the existing production at https://139.100.237.167.
The production server, database, Docker configuration, original PWA, and existing gateways are not modified.

## Implementation and preflight

- Use the AppDeploy frontend+backend html-static template and documented SDK API/router.
- Proxy only the fixed production origin and approved API path families; preserve authentication, methods, payloads, status, and relevant headers.
- Never retry writes, follow upstream redirects, log credentials, or cache business responses.
- Load the exact production frontend build b44db0b2084a5c0cc743 and verify each asset SHA-256.
- Expose a read-only connection check; preserve the production login screen and anonymous access boundary.
- Local routing/proxy tests, strict TypeScript checks, and Vite build passed before first deployment.
- AppDeploy tests cover diagnostics, protected login/empty credentials, and upstream failure/retry. The platform healthcheck is internal.

## Validation

Run `node --test tests/proxy.test.mjs`.
Local SDK declarations under .validation reflect the documented API and are for local compilation only; they are not deployed.
The real deployment still requires upstream API, browser, and affected-network tests.
Successful authentication and real business data must be checked with an authorized user session; no guessed credentials or production test writes.

## Limits

This is a temporary network recovery entry, not a fix for the original IP's selective reachability.
The gateway pins one frontend build; it deliberately fails closed if production assets change.
Uploads over approximately 3.6 MB and responses over 4 MB are rejected rather than silently truncated.
Documents/photos opened as direct production links and VK embedded authentication need separate verification.
The original installed PWA is not repointed by this deployment.

## Rollback

Close the alternate entry and use the original origin once its connectivity is restored.
Remove the separately installed recovery PWA if one was installed. No production rollback or database action is needed.
Keep this branch for review; do not merge it automatically into main.
