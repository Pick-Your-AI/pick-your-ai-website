import { defineConfig, devices } from '@playwright/test';

// Live checks against the deployed site (owned by operations; see docs/operations/).
// Run: PRODUCTION_URL=https://pickyour.ai npx playwright test -c tests/e2e-live/playwright.live.config.ts
const baseURL = process.env.PRODUCTION_URL ?? 'https://pickyour.ai';

export default defineConfig({
  testDir: '.',
  testMatch: '*.live.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  outputDir: '../../test-results/e2e-live',
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    {
      name: 'desktop-1440',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'laptop-1024',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } },
    },
    {
      name: 'tablet-768',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'mobile-375',
      use: {
        ...devices['iPhone 13'],
        defaultBrowserType: 'chromium',
        viewport: { width: 375, height: 812 },
      },
    },
  ],
});
