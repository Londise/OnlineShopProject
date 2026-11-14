import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  use: { headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  reporter: 'list',
});
