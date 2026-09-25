// Boots the full stack (backend :3001 in-process, demo-saas :3000 and
// dashboard preview :5173 as children), then drives the dashboard in headless
// Chromium: loads each tab, fails on page errors / failed API requests,
// and saves screenshots for human review. Foreground script: exits 0/1.
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import Fastify from 'fastify';
import { chromium } from '@playwright/test';
import { registerPlugins } from '../src/plugins/index.js';
import { registerRoutes } from '../src/routes/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_PORT = 3001;
const DEMO_PORT = 3000;
const DASHBOARD_PORT = 5173;
const SHOTS = path.resolve(__dirname, '../../../apps/dashboard/test-results');

async function waitFor(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${url}`);
    await new Promise(r => setTimeout(r, 500));
  }
}

async function portFree(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(2000) });
    await res.arrayBuffer().catch(() => undefined);
    return false;
  } catch {
    return true;
  }
}

async function main() {
  for (const port of [BACKEND_PORT, DEMO_PORT, DASHBOARD_PORT]) {
    if (!(await portFree(port))) {
      throw new Error(`port ${port} occupied (stale server?). Kill orphan node processes and re-run.`);
    }
  }
  fs.mkdirSync(SHOTS, { recursive: true });

  const app = Fastify();
  await registerPlugins(app);
  await registerRoutes(app);
  await app.listen({ port: BACKEND_PORT, host: '127.0.0.1' });
  console.log(`backend listening on :${BACKEND_PORT}`);

  const children: ChildProcess[] = [];
  const boot = (tag: string, cmd: string, cwd: string, env: Record<string, string> = {}) => {
    const child = spawn(cmd, [], { cwd, shell: true, env: { ...process.env, ...env }, stdio: 'pipe' });
    children.push(child);
    child.stdout?.on('data', d => process.stdout.write(`[${tag}] ${d}`));
    child.stderr?.on('data', d => process.stderr.write(`[${tag}:err] ${d}`));
    return child;
  };

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    boot('demo', 'npx tsx src/index.ts', path.resolve(__dirname, '../../../apps/demo-saas'), {
      DEMO_PORT: String(DEMO_PORT),
      SHAPI_URL: `http://localhost:${BACKEND_PORT}`,
      SHAPI_API_KEY: 'shapi_demo',
    });
    boot(
      'dashboard',
      `npx vite preview --port ${DASHBOARD_PORT} --strictPort`,
      path.resolve(__dirname, '../../../apps/dashboard'),
    );
    await waitFor(`http://localhost:${DEMO_PORT}/health`);
    await waitFor(`http://localhost:${DASHBOARD_PORT}/`);

    browser = await chromium.launch();
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    page.on('console', m => {
      if (m.type() === 'error') pageErrors.push(m.text());
    });
    page.on('requestfailed', r => failedRequests.push(`${r.url()} :: ${r.failure()?.errorText}`));
    page.on('response', r => {
      if (r.status() >= 400 && r.url().includes(`:${BACKEND_PORT}`)) {
        failedRequests.push(`${r.url()} :: HTTP ${r.status()}`);
      }
    });

    const shot = async (name: string) => {
      await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    };

    await page.goto(`http://localhost:${DASHBOARD_PORT}/`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'SHAPI' }).waitFor({ timeout: 10000 });
    await shot('01-overview');

    for (const tab of ['integrations', 'invariants', 'incidents', 'drift', 'events']) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      await page.waitForTimeout(1200); // allow fetch + render
      await shot(`02-${tab}`);
    }
    console.log('tabs visited: overview, integrations, invariants, incidents, drift, events');

    // core content assertions
    const body = (await page.content()).toLowerCase();
    for (const needle of ['shapi', 'behavioral']) {
      if (!body.includes(needle)) throw new Error(`dashboard HTML missing "${needle}"`);
    }

    console.log(`page errors: ${pageErrors.length}`, pageErrors.slice(0, 5));
    console.log(`failed API requests: ${failedRequests.length}`, failedRequests.slice(0, 5));
    if (pageErrors.length > 0) throw new Error(`dashboard had JS errors: ${pageErrors[0]}`);
    if (failedRequests.length > 0) throw new Error(`dashboard API calls failed: ${failedRequests[0]}`);

    console.log(`DASHBOARD TEST OK — screenshots in ${SHOTS}`);
  } finally {
    await browser?.close().catch(() => undefined);
    for (const child of children) child.kill();
    await app.close();
  }
}

main().then(
  () => process.exit(0),
  e => {
    console.error('DASHBOARD TEST FAILED:', e);
    process.exit(1);
  },
);
