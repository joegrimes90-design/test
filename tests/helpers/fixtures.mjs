// Playwright `test` with an automatic console watchdog: any page error,
// console.error, failed request or HTTP error fails the test that caused it.
import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  consoleErrors: [async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
    page.on('requestfailed', (r) => {
      const why = r.failure()?.errorText || '';
      // media elements routinely cancel range requests when they switch source
      if (!why.includes('ERR_ABORTED')) errors.push(`request failed: ${r.url()} ${why}`);
    });
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });
    await use(errors);
    expect(errors, 'page errors / console errors').toEqual([]);
  }, { auto: true }],
});

export { expect };
