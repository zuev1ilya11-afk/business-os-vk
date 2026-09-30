# Startup asset packaging

The 2026-09-30 cold-start waterfall contained 146 JavaScript requests for the owner.
Under 600 ms latency, classic-script downloads and the later role scripts kept the
app waiting for about 17 seconds, despite one successful bootstrap request.

`npm run build` now packages the existing startup scripts into two generated files:

- `startup-shell.bundle.js`: the 94 scripts listed, in order, in
  `scripts/startup-assets.json`.
- `startup-eager.bundle.js`: the 29 additional eager scripts listed in
  `pwa-register.js`, excluding scripts already in the shell.

Original source files remain editable and are copied verbatim, separated by a
newline and semicolon. There is no minifier, renaming, dependency change, or
business-logic rewrite. `build-version.js` and `pwa-register.js` remain separate;
the existing lazy master/dispatcher role lists are unchanged.

The build manifest maps source URLs to their bundle via `BOS_ASSET_URL`. The
existing eager-loader URL check prevents duplicate execution. Only bundle bytes
are precached for packaged sources. A new worker still recognizes original source
URLs from old tabs and serves their exact previous-build cache. It does not send
new bundle bytes to an old client. Digest validation, user-approved activation,
draft preservation, and cache rotation retain the same behavior.

`build:check` rejects stale bundle bytes or changed source order. When adding a
startup module, update the source-order manifest; keep role modules in their
existing lazy lists. Do not edit generated bundles directly.

## Reproducible measurements

Command: `node scripts/measure-startup.cjs . output.json`.
Three alternating baseline/candidate runs, each in a fresh Chromium Pixel 7
context, gzip localhost HTTP/1.1 and fixture API. Baseline is the application tree
at PR #219. Results are lab measurements, not carrier/VPN or HTTP/2 benchmarks.

| Profile | Baseline readiness, median | Packaged readiness, median | Candidate FCP, median |
| --- | ---: | ---: | ---: |
| Fast 4G, 60 ms | 2037 ms | 1032 ms | 260 ms |
| Slow 4G, 150 ms | 5074 ms | 2501 ms | 552 ms |
| High latency, 600 ms | 17163 ms | 5339 ms | 1872 ms |

For every profile: JS requests 146 → 25, encoded JS bytes 418924 → 308129,
one bootstrap and zero JavaScript errors in every sample. First paint was already
early; this change primarily reduces the time to the usable authenticated shell.
Real phones, Safari/WebKit, carrier DNS/IPv6, VPN/MTU and packet loss still require
device/network testing. A cold start at 600 ms latency still takes about 5.3 s.

Regression checks include generated artifact integrity, all three employee-role
startup paths, session restore, offline recovery, module deduplication, and an
unbundled-to-bundled PWA update with an old tab kept open and both tabs offline.
