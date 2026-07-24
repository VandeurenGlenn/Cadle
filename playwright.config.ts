import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:4333', channel: 'chrome', headless: true },
  webServer: {
    command: 'npm run standalone:serve',
    url: 'http://127.0.0.1:4333',
    reuseExistingServer: true
  }
})
