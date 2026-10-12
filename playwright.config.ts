import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.MOOD_QA_PORT || 4173);

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${port}/MoodTracker/`,
    timezoneId: 'Europe/Amsterdam',
    locale: 'en-GB',
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/qa-server.mjs',
    url: `http://127.0.0.1:${port}/__qa/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
    env: { MOOD_QA_PORT: String(port) },
  },
});
