#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Local fallback when this environment cannot create a Linux network namespace.
# Block Node sockets/DNS/fetch in all child processes; Chromium is proxy-blocked.
export BOS_TEST_OFFLINE=1 BOS_TEST_ARCHIVE_GAS=0
export NODE_OPTIONS="--require $PWD/scripts/offline-node-preload.cjs"
unset HTTPS_PROXY HTTP_PROXY ALL_PROXY https_proxy http_proxy all_proxy
exec node node_modules/playwright/cli.js test "$@"
