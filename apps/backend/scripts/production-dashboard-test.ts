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
const context = await browser.newContext();
await context.addInitScript(({ configuredApiUrl, configuredApiKey }) => {
  (window as unknown as { __SHAPI_CONFIG__?: { apiUrl: string; apiKey: string } }).__SHAPI_CONFIG__ = {
    apiUrl: configuredApiUrl,
    apiKey: configuredApiKey,
  };
}, { configuredApiUrl: apiUrl, configuredApiKey: apiKey });

const page = await context.newPage();
const pageErrors: string[] = [];
const failedRequests: string[] = [];
page.on('pageerror', error => pageErrors.push(String(error)));
page.on('console', message => {
  if (message.type() === 'error') pageErrors.push(message.text());
});
page.on('requestfailed', request => {
  failedRequests.push(`${request.url()} :: ${request.failure()?.errorText ?? 'request failed'}`);
});
page.on('response', response => {
  if (response.status() >= 400 && response.url().startsWith(apiUrl)) {
    failedRequests.push(`${response.url()} :: HTTP ${response.status()}`);
  }
});

try {
  await page.goto(`${dashboardUrl}/`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Command center' }).waitFor({ timeout: 15000 });
  await page.getByText(/Live SHAPI telemetry/u).first().waitFor({ timeout: 15000 });
  await page.getByRole('heading', { name: 'Repair targets', exact: true }).waitFor({ timeout: 15000 });

  await page.getByRole('button', { name: 'Run diagnosis', exact: true }).click();
  await page.getByRole('heading', { name: /No live incident selected|Live incident diagnosis|Live diagnosis complete/u }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Done', exact: true }).last().click();

  if (pageErrors.length > 0) throw new Error(`dashboard JavaScript error: ${pageErrors[0]}`);
  if (failedRequests.length > 0) throw new Error(`dashboard request failed: ${failedRequests[0]}`);
  console.log('Production dashboard smoke passed: command center, live telemetry, repair targets, and diagnosis modal.');
} finally {
  await context.close();
  await browser.close();
}
