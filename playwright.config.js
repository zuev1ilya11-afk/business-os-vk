const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests',
  reporter: process.env.CI ? 'list' : undefined,
  testMatch: '**/*.spec.js',
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    // Tests fulfill remote API URLs with fixtures. Any missed route (including
    // service-worker traffic) must fail locally instead of reaching a live API.
    proxy: { server: 'http://127.0.0.1:9', bypass: '127.0.0.1,localhost' },
    launchOptions: { proxy: { server: 'http://127.0.0.1:9', bypass: '127.0.0.1,localhost' } }
  },
  webServer: {
    command: 'python3 -m http.server 4173 --bind 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 30000
  }
});
