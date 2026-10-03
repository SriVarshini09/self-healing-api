// Run after `pnpm --dir dashboard build`. Reuses the workspace's Playwright.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

const requireWorkspace = createRequire(new URL('../../apps/dashboard/package.json', import.meta.url));
const { chromium, expect } = requireWorkspace('@playwright/test');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = fileURLToPath(new URL('../../output/shapi-landing/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await preview({ root, preview: { host: '127.0.0.1', port: 5188, strictPort: true } });
let browser;
const origin = 'http://127.0.0.1:5188';

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  const failedAssets = [];
  const unexpectedRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failedAssets.push(response.url()); });
  page.on('request', request => {
    if (/\/api\/|\/config\.js(?:\?|$)/u.test(request.url())) unexpectedRequests.push(request.url());
  });

  const redirect = await context.request.get(`${origin}/landing?test=1`, { maxRedirects: 0 });
  assert.equal(redirect.status(), 308);
  assert.equal(redirect.headers().location, '/landing/?test=1');
  await page.goto(`${origin}/landing`);
  await expect(page).toHaveURL(`${origin}/landing/`);
  await expect(page).toHaveTitle('SHAPI — Prove the outcome');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('doesn’t prove');
  await page.evaluate(() => document.fonts.ready);
  assert(await page.evaluate(() => document.fonts.check('16px "Archivo Variable"')));
  await page.screenshot({ path: `${output}/desktop-hero.png` });

  await page.getByRole('link', { name: 'Explore the demo' }).first().click();
  await expect(page).toHaveURL(/#demo$/u);
  await expect(page.locator('.demo-evidence')).toHaveAttribute('data-stage', '0');
  await page.getByRole('button', { name: '02 Outcome failed' }).click();
  await expect(page.locator('.evidence-record')).toContainText('provisioning.failed');
  await page.getByRole('button', { name: '03 Diagnosis' }).click();
  await expect(page.locator('.evidence-record')).toContainText('Minimum: 5 samples');
  await page.getByRole('button', { name: '04 Patch ready for review' }).click();
  await expect(page.locator('.evidence-record')).toContainText('business-outcome.ts');
  await expect(page.locator('.evidence-record')).toContainText('business-outcome');
  await page.getByRole('button', { name: 'Subscription activation', exact: true }).click();
  await expect(page.locator('.demo-evidence')).toHaveAttribute('data-stage', '0');
  await expect(page.locator('.evidence-record')).toContainText('customer.subscription.created');
  await page.getByRole('button', { name: '02 Outcome failed' }).click();
  await expect(page.locator('.evidence-record')).toContainText('subscription.activation_failed');
  await page.getByRole('button', { name: '04 Patch ready for review' }).click();
  await expect(page.locator('.evidence-record')).toContainText('subscription-outcome.ts');
  await page.getByRole('button', { name: 'Restart', exact: true }).click();

  // Controlled browser time checks playback without a real twelve-second wait.
  await page.clock.install();
  await page.getByRole('button', { name: 'Play demo', exact: true }).click();
  await page.clock.runFor(3050);
  await expect(page.locator('.demo-evidence')).toHaveAttribute('data-stage', '1');
  await page.getByRole('button', { name: 'Pause demo', exact: true }).click();
  await page.clock.runFor(4000);
  await expect(page.locator('.demo-evidence')).toHaveAttribute('data-stage', '1');
  await page.getByRole('button', { name: 'Play demo', exact: true }).click();
  await page.clock.runFor(3050);
  await expect(page.locator('.demo-evidence')).toHaveAttribute('data-stage', '2');
  await page.clock.runFor(3050);
  await expect(page.locator('.demo-evidence')).toHaveAttribute('data-stage', '3');
  await page.clock.runFor(3050);
  await expect(page.getByRole('button', { name: 'Play demo', exact: true })).toHaveText('Play again');
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await page.getByRole('button', { name: 'Play demo', exact: true }).click();
  await page.getByRole('link', { name: 'Developers', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play demo', exact: true })).toBeVisible();
  await page.clock.runFor(4000);
  await expect(page.locator('.demo-evidence')).toHaveAttribute('data-stage', '0');

  // Clipboard is stubbed so the smoke never changes the operator's clipboard.
  await page.evaluate(() => {
    window.__testCopiedText = '';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__testCopiedText = value; } } });
  });
  await page.getByRole('button', { name: 'Copy SDK example' }).click();
  await expect(page.getByRole('status')).toContainText('Example copied');
  assert.match(await page.evaluate(() => window.__testCopiedText), /webhookReporter/u);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } }));
  await page.getByRole('button', { name: 'Copy SDK example' }).click();
  await expect(page.getByRole('status')).toContainText('Select the code above');
  for (const summary of await page.locator('summary').all()) {
    await summary.focus();
    await page.keyboard.press('Enter');
    assert.equal(await summary.evaluate(node => node.parentElement.open), true);
    await page.keyboard.press('Enter');
  }
  assert.equal(await page.locator('a[href="/"]').count(), 4);
  assert((await page.locator('a[href="https://github.com/SriVarshini09/self-healing-api#readme"]').count()) >= 3);

  for (const width of [1920, 1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${origin}/landing/`);
    await page.evaluate(() => document.fonts.ready);
    const dimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
    assert(dimensions.page <= dimensions.viewport + 1, `Horizontal overflow at ${width}px: ${JSON.stringify(dimensions)}`);
    await page.screenshot({ path: `${output}/landing-${width}.png`, fullPage: true });
    if (width === 390) {
      await page.getByRole('button', { name: 'Open menu' }).click();
      await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused();
      await page.getByRole('button', { name: 'Open menu' }).click();
      await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'Demo', exact: true }).click();
      await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeHidden();
    }
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/landing/#developers`);
  await page.reload();
  await expect(page).toHaveURL(/#developers$/u);
  await expect(page.getByRole('heading', { name: 'Make success explicit.' })).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'Overflow at 200% zoom');
  await page.screenshot({ path: `${output}/landing-200-percent.png`, fullPage: true });

  assert.deepEqual(errors, [], 'Browser runtime errors');
  assert.deepEqual(failedAssets, [], 'Failed page assets');
  assert.deepEqual(unexpectedRequests, [], 'Landing must not request dashboard config or backend APIs');

  // Root remains the original dashboard. Stub auth/config only for this check.
  const dashboardPage = await context.newPage();
  await dashboardPage.route('**/config.js', route => route.fulfill({ contentType: 'application/javascript', body: 'window.__SHAPI_CONFIG__ = { apiUrl: "/api/v1", apiKey: "" };' }));
  await dashboardPage.route('**/api/v1/auth/me', route => route.fulfill({ status: 401, body: '{}' }));
  await dashboardPage.route('**/api/v1/auth/config', route => route.fulfill({ contentType: 'application/json', body: '{"oidcEnabled":true}' }));
  await dashboardPage.goto(origin);
  await expect(dashboardPage.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
  await expect(dashboardPage.locator('#landing-root')).toHaveCount(0);
  console.log('PASS: landing redirects, both scenarios, playback, offscreen pause, copy states, keyboard FAQ/menu, five responsive widths, zoom, isolated network, and original dashboard.');
  console.log(`Screenshots: ${output}`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
