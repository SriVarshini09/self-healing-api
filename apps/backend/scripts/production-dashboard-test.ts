// Read-only browser smoke for the production dashboard served by Docker.
// It checks the real command center, live API wiring, repair-target panel, and
// diagnosis modal without creating incidents, replay jobs, or pull requests.
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
const apiUrl = option('--api-url', 'http://localhost:3001/api/v1').replace(/\/$/u, '');
const envFile = option('--env-file', '.env');
const apiKey = readEnv(envFile).SHAPI_API_KEY;
if (!apiKey) throw new Error(`SHAPI_API_KEY was not found in ${envFile}`);

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
  if (mode.requireSameOrigin) {
    await page.route('**/config.js', route => route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `window.__SHAPI_CONFIG__ = ${JSON.stringify({ apiUrl: mode.configuredApiUrl, apiKey })};`,
    }));
  }
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
    await page.getByRole('heading', { name: 'Command center' }).waitFor({ timeout: 15000 });
    await page.getByText(/Live SHAPI telemetry/u).first().waitFor({ timeout: 15000 });
    await page.getByRole('heading', { name: 'Repair targets', exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole('heading', { name: 'Alert delivery', exact: true }).waitFor({ timeout: 15000 });

    await page.getByRole('button', { name: 'Run diagnosis', exact: true }).click();
    await page.getByRole('heading', { name: /No live incident selected|Live incident diagnosis|Live diagnosis complete/u }).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'Done', exact: true }).last().click();

    if (pageErrors.length > 0) throw new Error(`${mode.label} dashboard JavaScript error: ${pageErrors[0]}`);
    if (failedRequests.length > 0) throw new Error(`${mode.label} dashboard request failed: ${failedRequests[0]}`);
    if (mode.requireSameOrigin && apiRequests.length === 0) {
      throw new Error(`same-origin dashboard smoke observed no /api/v1 proxy requests; observed: ${[...new Set(allRequests)].join(', ')}`);
    }
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
  console.log('Production dashboard smoke passed: direct API, same-origin proxy, command center, live telemetry, alert delivery, repair targets, and diagnosis modal.');
} finally {
  await browser.close();
}
