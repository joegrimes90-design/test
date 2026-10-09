// Playwright Test config: end-to-end (tests/e2e) and visual quality (tests/visual)
// suites, Chromium only. Unit tests (tests/unit) run with `node --test`.
import fs from 'node:fs';
import { defineConfig } from '@playwright/test';

// Use the preinstalled browsers when present (never `playwright install` here).
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';

const PORT = +(process.env.TEST_PORT || 4173);

export default defineConfig({
  testDir: 'tests',
  outputDir: 'test-results',
  // Painting this game is CPU-heavy; two browsers at a time is the sweet spot on 4 cores.
  workers: process.env.CI ? 1 : 2,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    browserName: 'chromium',
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'e2e',
      testDir: 'tests/e2e',
      testMatch: /.*\.spec\.mjs$/,
      // Small, 1x viewport: these tests check behaviour, not pixels, and painting is the slow part.
      use: { viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 },
    },
    {
      name: 'visual',
      testDir: 'tests/visual',
      testMatch: /.*\.spec\.mjs$/,
      // High-DPI, like a retina laptop or tablet: blur from lower-resolution rasterisation shows up here.
      use: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 },
    },
  ],
  webServer: {
    command: `node tests/server.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
