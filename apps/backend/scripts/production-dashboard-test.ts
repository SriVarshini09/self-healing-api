// Read-only browser smoke for the production dashboard served by Docker.
// It checks the real command center, live API wiring, connection/onboarding
// panel, repair-target panel, and diagnosis modal without creating incidents,
// replay jobs, or pull requests.
import fs from 'node:fs';
import { chromium } from '@playwright/test';

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function readEnv(path: string): Record<string, string> {
  const values: Record<string, string> = {};
  if (!fs.existsSync(path)) return values;
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^"|"$/gu, '').replace(/^'|'$/gu, '');
  }
  return values;
}

const dashboardUrl = option('--dashboard-url', 'http://localhost:8080').replace(/\/$/u, '');
const apiInput = option('--api-url', 'http://localhost:3001').replace(/\/$/u, '');
const apiUrl = apiInput.endsWith('/api/v1') ? apiInput : `${apiInput}/api/v1`;
const envFile = option('--env-file', '.env');
const apiKey = readEnv(envFile).SHAPI_API_KEY;
if (!apiKey) throw new Error(`SHAPI_API_KEY was not found in ${envFile}`);

const incidentsResponse = await fetch(`${apiUrl}/incidents?pageSize=100`, {
  headers: { 'x-api-key': apiKey },
});
if (!incidentsResponse.ok) {
  throw new Error(`incident snapshot failed: HTTP ${incidentsResponse.status}`);
}

const browser = await chromium.launch({ headless: true });

async function runDashboardSmoke(mode: {
  label: string;
  configuredApiUrl: string;
  apiRequestPrefix: string;
  requireSameOrigin: boolean;
}) {
  const context = await browser.newContext();
  await context.addInitScript(({ configuredApiUrl, configuredApiKey }) => {
    (window as unknown as { __SHAPI_CONFIG__?: { apiUrl: string; apiKey: string } }).__SHAPI_CONFIG__ = {
      apiUrl: configuredApiUrl,
      apiKey: configuredApiKey,
    };
  }, { configuredApiUrl: mode.configuredApiUrl, configuredApiKey: apiKey });

  const page = await context.newPage();
  // The deployed dashboard loads config.js after the document starts. Route it
  // in both modes so the direct-API test cannot be overwritten by the default
  // same-origin runtime configuration before React mounts.
  await page.route('**/config.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `window.__SHAPI_CONFIG__ = ${JSON.stringify({ apiUrl: mode.configuredApiUrl, apiKey })};`,
  }));
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const apiRequests: string[] = [];
  const allRequests: string[] = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });
  page.on('requestfailed', request => {
    failedRequests.push(`${request.url()} :: ${request.failure()?.errorText ?? 'request failed'}`);
  });
  page.on('request', request => {
    allRequests.push(request.url());
    if (request.url().startsWith(mode.apiRequestPrefix)) apiRequests.push(request.url());
  });
  page.on('response', response => {
    if (response.status() >= 400 && response.url().startsWith(mode.apiRequestPrefix)) {
      failedRequests.push(`${response.url()} :: HTTP ${response.status()}`);
    }
  });

  try {
    await page.goto(`${dashboardUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /^(Overview|Outcome protection)$/u }).waitFor({ timeout: 15000 });
    await page.getByText(/Live SHAPI telemetry/u).first().waitFor({ timeout: 15000 });
    await page.getByRole('heading', { name: 'Protection signals', exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole('heading', { name: 'Repair activity', exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole('heading', { name: 'Recent protection signals', exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole('heading', { name: 'GitHub repair connection', exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole('heading', { name: 'Connected integrations', exact: true }).waitFor({ timeout: 15000 });
    const setupButtons = page.getByRole('button', { name: 'Setup', exact: true });
    const hasSetupButton = (await setupButtons.count()) > 0;
    if (hasSetupButton) {
      await setupButtons.first().click();
      await page.getByText('Webhook endpoint', { exact: true }).waitFor({ timeout: 15000 });
    }
    const deliveryButtons = page.getByRole('button', { name: 'Deliveries', exact: true });
    const hasDeliveryButton = (await deliveryButtons.count()) > 0;
    if (hasDeliveryButton) {
      await deliveryButtons.first().click();
      await page.getByText('Recent deliveries', { exact: true }).waitFor({ timeout: 15000 });
    }
    await page.getByRole('heading', { name: 'Outcome coverage setup', exact: true }).waitFor({ timeout: 15000 });
    await page.getByLabel('Repair readiness summary').getByText(/ready for target review/u).waitFor({ timeout: 15000 });
    // A fresh tenant may have all targets ready after reviewed mappings are
    // seeded, while an older tenant may still contain manual-review targets.
    // The summary above and the live repair-review counts are the authoritative
    // assertions; require at least one explicit state label without assuming
    // both states exist in every tenant.
    await page.getByText(/MANUAL REVIEW|READY FOR TARGET REVIEW/u).first().waitFor({ timeout: 15000 });
    await page.getByText('Repair review', { exact: true }).waitFor({ timeout: 15000 });
    const repairReviewCell = page.locator('p').filter({ hasText: 'Repair review' }).first().locator('..');
    // The dashboard refreshes its live incident snapshot independently from
    // the API snapshot above. Assert the rendered count shape rather than
    // comparing two independently timed snapshots and creating a false race.
    const repairReviewValue = repairReviewCell.locator('p').first();
    const prReadyValue = repairReviewCell.locator('p').filter({ hasText: 'PR-ready' }).first();
    await repairReviewValue.waitFor({ timeout: 15000 });
    await prReadyValue.waitFor({ timeout: 15000 });
    const repairReviewText = (await repairReviewValue.innerText()).trim();
    const prReadyText = (await prReadyValue.innerText()).trim();
    if (!/^\d+$/u.test(repairReviewText)) {
      throw new Error(`Repair review count was not numeric: ${repairReviewText}`);
    }
    if (!/^\d+\s+PR-ready$/u.test(prReadyText)) {
      throw new Error(`PR-ready count had an unexpected shape: ${prReadyText}`);
    }
    await page.getByRole('heading', { name: 'Alert delivery', exact: true }).waitFor({ timeout: 15000 });
    for (const label of ['Pending', 'Processing', 'Retrying', 'Failed', 'Delivered']) {
      await page.getByText(label, { exact: true }).waitFor({ timeout: 15000 });
    }

    await page.getByRole('button', { name: 'Run diagnosis', exact: true }).click();
    await page.getByRole('heading', { name: /No live incident selected|Live incident diagnosis|Live diagnosis complete/u }).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'Done', exact: true }).last().click();

    if (pageErrors.length > 0) throw new Error(`${mode.label} dashboard JavaScript error: ${pageErrors[0]}`);
    if (failedRequests.length > 0) throw new Error(`${mode.label} dashboard request failed: ${failedRequests[0]}`);
    if (mode.requireSameOrigin && apiRequests.length === 0) {
      throw new Error(`same-origin dashboard smoke observed no /api/v1 proxy requests; observed: ${[...new Set(allRequests)].join(', ')}`);
    }
    if (!apiRequests.some(url => url.includes('/github/status'))) {
      throw new Error(`${mode.label} dashboard smoke observed no GitHub status request`);
    }
    if (!apiRequests.some(url => url.includes('/integrations?pageSize=100'))) {
      throw new Error(`${mode.label} dashboard smoke observed no integrations request`);
    }
    if (hasSetupButton && !apiRequests.some(url => url.includes('/webhook-url'))) {
      throw new Error(`${mode.label} dashboard smoke observed no webhook setup request`);
    }
    if (hasDeliveryButton && !apiRequests.some(url => url.includes('/webhook-events?pageSize=5'))) {
      throw new Error(`${mode.label} dashboard smoke observed no webhook deliveries request`);
    }
  } finally {
    await context.close();
  }
}

async function runOidcAccessSmoke() {
  const context = await browser.newContext();
  const oidcDashboardUrl = /^http:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/u.test(dashboardUrl)
    ? dashboardUrl.replace(/(localhost|127\.0\.0\.1)/u, 'dashboard.localtest.me')
    : dashboardUrl;
  await context.route('**/config.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.__SHAPI_CONFIG__ = { apiUrl: "/api/v1", apiKey: "" };',
  }));
  await context.route('**/api/v1/auth/me', route => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Not authenticated' }),
  }));
  await context.route('**/api/v1/auth/config', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ oidcEnabled: true }),
  }));
  try {
    const page = await context.newPage();
    await page.goto(`${oidcDashboardUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Sign in to continue' }).waitFor({ timeout: 15000 });
    const login = page.getByRole('link', { name: 'Sign in with SSO', exact: true });
    await login.waitFor({ timeout: 15000 });
    if (!(await login.getAttribute('href'))?.endsWith('/auth/login')) {
      throw new Error('OIDC access smoke found an invalid SSO login URL');
    }
  } finally {
    await context.close();
  }
}

async function runOidcSessionSmoke() {
  const context = await browser.newContext();
  const oidcDashboardUrl = /^http:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/u.test(dashboardUrl)
    ? dashboardUrl.replace(/(localhost|127\.0\.0\.1)/u, 'dashboard.localtest.me')
    : dashboardUrl;
  let signOutCalled = false;
  await context.route('**/config.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.__SHAPI_CONFIG__ = { apiUrl: "/api/v1", apiKey: "" };',
  }));
  await context.route('**/api/v1/**', route => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname;
    const fulfillJson = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
    if (path.endsWith('/auth/me')) {
      return fulfillJson({ user: { id: 'oidc-user', name: 'OIDC Smoke User', tenantId: 'tenant', role: 'OWNER' } });
    }
    if (path.endsWith('/auth/logout') && route.request().method() === 'POST') {
      signOutCalled = true;
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith('/drift/summary')) {
      return fulfillJson({ totalInvariants: 0, monitoredIntegrations: 0, activeAlerts: 0 });
    }
    if (path.endsWith('/incidents')) return fulfillJson({ data: [] });
    if (path.endsWith('/alerts/status')) {
      return fulfillJson({ webhookConfigured: false, pending: 0, processing: 0, retrying: 0, delivered: 0, failed: 0 });
    }
    if (path.endsWith('/github/status')) {
      return fulfillJson({ mode: 'unconfigured', message: 'OIDC smoke', appCredentialsConfigured: false, tokenConfigured: false, webhookConfigured: false, realInstallations: 0, installationCount: 0, repositoryCount: 0, appInstallUrl: null });
    }
    if (path.endsWith('/integrations')) return fulfillJson({ data: [] });
    if (path.endsWith('/invariants')) return fulfillJson({ data: [] });
    if (path.endsWith('/github/installations')) return fulfillJson([]);
    return fulfillJson({ data: [] });
  });
  try {
    const page = await context.newPage();
    await page.goto(`${oidcDashboardUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.waitForTimeout(250);
    if (!signOutCalled) throw new Error('OIDC session smoke did not call the logout endpoint');
  } finally {
    await context.close();
  }
}

try {
  await runDashboardSmoke({
    label: 'direct API',
    configuredApiUrl: apiUrl,
    apiRequestPrefix: apiUrl,
    requireSameOrigin: false,
  });
  await runDashboardSmoke({
    label: 'same-origin proxy',
    configuredApiUrl: '/api/v1',
    apiRequestPrefix: `${dashboardUrl}/api/v1`,
    requireSameOrigin: true,
  });
  await runOidcAccessSmoke();
  await runOidcSessionSmoke();
  console.log('Production dashboard smoke passed: direct API, same-origin proxy, live telemetry, OIDC access gate, OIDC session sign-out, connection panel, integration list, repair review queue, alert delivery, repair targets, and diagnosis modal.');
} finally {
  await browser.close();
}
