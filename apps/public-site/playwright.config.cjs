const { defineConfig } = require("@playwright/test");
const path = require("node:path");
process.env.WEBSITE_E2E_STATE =
  process.env.WEBSITE_E2E_STATE ||
  path.resolve(
    __dirname,
    "../../test-results/website-state-" + process.pid + "-" + Date.now(),
  );
module.exports = defineConfig({
  testDir: "./e2e",
  timeout: 90000,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4191",
    browserName: "chromium",
    trace: "off",
    actionTimeout: 15000,
  },
  webServer: {
    command: "node server.cjs --port 4191",
    url: "http://127.0.0.1:4191/healthz",
    timeout: 90000,
    reuseExistingServer: false,
    env: {
      NODE_ENV: "production",
      WEBSITE_INTERNAL_API_ORIGIN: "http://127.0.0.1:4191",
      WEBSITE_ENV: "staging",
      NEXT_PUBLIC_SITE_URL: "https://website-stage.invalid",
      NEXT_TELEMETRY_DISABLED: "1",
      WEBSITE_STAGE_STATE: process.env.WEBSITE_E2E_STATE,
    },
    stdout: "ignore",
    stderr: "pipe",
  },
});
