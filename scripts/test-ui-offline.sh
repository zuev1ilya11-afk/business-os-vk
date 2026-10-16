#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# CI Linux runner only. Isolate Node, browser, service workers and the local HTTP
# server together. Failure to create the namespace is fatal; no network fallback.
# Dependencies/browsers must be installed before this step.
BOS_UI_NODE_BIN="$(command -v node)"
BOS_UI_BROWSER_CACHE="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
sudo env "CI=${CI:-}" BOS_TEST_OFFLINE=1 "PLAYWRIGHT_BROWSERS_PATH=$BOS_UI_BROWSER_CACHE" unshare --net -- bash -ceu '
 ip link set lo up
 exec "$@"
' bos-ui-offline "$BOS_UI_NODE_BIN" node_modules/playwright/cli.js test "$@"
