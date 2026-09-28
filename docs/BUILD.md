# Production build

Run `npm run build` after changing browser assets and commit its output with the change.
`npm run build:check` in CI rejects stale generated files. GitHub Pages continues to
publish the repository root; no hosting setting or separate deployment is required.

The content-derived BUILD_ID ties index.html, build-version.js, Service Worker,
and dynamically loaded scripts together. Historical per-file query versions in
other code do not define a release. Use BOS_ASSET_URL for new dynamic loaders.

The worker verifies the asset manifest before installing. An update waits until
the user saves work and selects “Обновить”. Navigation stays on the installed
shell until activation, then reloads once. The previous cache is retained for
older tabs; unrelated origin caches and API responses are not deleted/cached.

Check `window.BOS_APP_VERSION` or the `bos-build-id` HTML meta tag to identify the
published build. Revert a release by reverting its source changes and running
`npm run build` again; do not hand-edit generated IDs.
