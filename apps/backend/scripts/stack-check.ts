// Boots backend (:3001) in-process + demo-saas (:3000) + dashboard preview
// (:5173) as children, then exercises the Stripe flow over real HTTP.
// Foreground script: exits 0/1.
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import Fastify from 'fastify';
import { registerPlugins } from '../src/plugins/index.js';
import { registerRoutes } from '../src/routes/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_PORT = 3001;
const DEMO_PORT = 3000;
const DASHBOARD_PORT = 5173;

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
    return false; // something answered — port occupied
  } catch {
    return true;
  }
}

async function main() {
  for (const port of [BACKEND_PORT, DEMO_PORT, DASHBOARD_PORT]) {
    if (!(await portFree(port))) {
      throw new Error(
        `port ${port} is already occupied (stale server?). Kill orphan node processes and re-run.`,
      );
    }
  }

  const app = Fastify();
  await registerPlugins(app);
  await registerRoutes(app);
  await app.listen({ port: BACKEND_PORT, host: '127.0.0.1' });
  console.log(`backend listening on :${BACKEND_PORT}`);

  const children: ChildProcess[] = [];
  const boot = (tag: string, cmd: string, cwd: string, env: Record<string, string> = {}) => {
    const child = spawn(cmd, [], {
      cwd,
      shell: true,
      env: { ...process.env, ...env },
      stdio: 'pipe',
    });
    children.push(child);
    child.stdout?.on('data', d => process.stdout.write(`[${tag}] ${d}`));
    child.stderr?.on('data', d => process.stderr.write(`[${tag}:err] ${d}`));
    return child;
  };

  try {
    const API_KEY = process.env.SHAPI_API_KEY || 'shapi_demo_local_d3v_k3y_9f2c';
    const apiHeaders = { 'x-api-key': API_KEY };
    boot('demo', 'npx tsx src/index.ts', path.resolve(__dirname, '../../../apps/demo-saas'), {
      DEMO_PORT: String(DEMO_PORT),
      SHAPI_URL: `http://localhost:${BACKEND_PORT}`,
      SHAPI_API_KEY: API_KEY,
    });
    boot(
      'dashboard',
      `npx vite preview --port ${DASHBOARD_PORT} --strictPort`,
      path.resolve(__dirname, '../../../apps/dashboard'),
    );

    await waitFor(`http://localhost:${DEMO_PORT}/health`);
    await waitFor(`http://localhost:${DASHBOARD_PORT}/`);

    const post = async (url: string, body: unknown, headers: Record<string, string> = {}) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.text() };
    };

    // failure path: 200 OK but no provisioning
    await post(`http://localhost:${DEMO_PORT}/admin/failure-mode`, { enabled: true });
    const co = JSON.parse(
      (await post(`http://localhost:${DEMO_PORT}/checkout`, { email: 'stack@test.com', plan: 'pro' })).body,
    );
    const wh = await post(
      `http://localhost:${DEMO_PORT}/webhooks/stripe`,
      {
        id: `evt_stack_${Date.now()}`,
        type: 'invoice.payment_succeeded',
        data: { object: { customer: co.customerId, amount_paid: 2000, status: 'paid' } },
      },
      { 'stripe-signature': 'test' },
    );
    console.log('demo webhook status:', wh.status);
    if (wh.status !== 200) throw new Error('demo webhook must return 200');

    // backend received + evaluated it (async processing — poll)
    let seen = false;
    for (let i = 0; i < 20; i++) {
      const r = await fetch(
        `http://localhost:${BACKEND_PORT}/api/v1/integrations/stripe-demo/webhook-events?pageSize=5`,
        { headers: apiHeaders },
      );
      const data = (await r.json()) as any;
      if (data.data?.some((e: any) => e.status === 'COMPLETED' || e.status === 'PROCESSING')) {
        seen = true;
        break;
      }
      await new Promise(r2 => setTimeout(r2, 500));
    }
    console.log('backend ingested + processed webhook:', seen);
    if (!seen) throw new Error('backend did not process demo webhook');

    const sdk = await fetch(`http://localhost:${BACKEND_PORT}/api/v1/sdk/events?pageSize=5`, {
      headers: apiHeaders,
    });
    console.log('sdk events reachable:', sdk.status);

    // Full behavioral story: the failure webhook returned 200, but the tracked
    // provisioning.failed outcome must flip its invariant and open an incident.
    let violated = false;
    for (let i = 0; i < 20; i++) {
      const r = await fetch(`http://localhost:${BACKEND_PORT}/api/v1/invariants?pageSize=20`, {
        headers: apiHeaders,
      });
      const data = (await r.json()) as any;
      const prov = data.data?.find((v: any) => v.id === 'inv-stripe-provisioning');
      if (prov?.status === 'VIOLATED') {
        violated = true;
        break;
      }
      await new Promise(r2 => setTimeout(r2, 500));
    }
    console.log('provisioning invariant violated:', violated);
    if (!violated) throw new Error('provisioning.failed did not violate its invariant');

    const inc = await fetch(`http://localhost:${BACKEND_PORT}/api/v1/incidents?pageSize=5`, {
      headers: apiHeaders,
    });
    const incData = (await inc.json()) as any;
    console.log('incidents open:', incData.data?.length, '|', incData.data?.[0]?.title);
    if (!incData.data?.length) throw new Error('expected a violation incident');

    // dashboard serves the built UI
    const dash = await fetch(`http://localhost:${DASHBOARD_PORT}/`);
    const dashHtml = await dash.text();
    console.log('dashboard status:', dash.status, '| serves UI:', dashHtml.includes('<div id="root">'));
    if (dash.status !== 200 || !dashHtml.includes('<div id="root">')) {
      throw new Error('dashboard preview did not serve the built UI');
    }

    // dashboard can reach the backend API (CORS + wiring + auth)
    const uiInvariants = await fetch(`http://localhost:${BACKEND_PORT}/api/v1/invariants?pageSize=1`, {
      headers: apiHeaders,
    });
    console.log('dashboard API wiring (invariants):', uiInvariants.status);
    if (!uiInvariants.ok) throw new Error('dashboard API wiring failed');

    // The demo also exercises the distinct subscription activation outcome.
    const subscription = await post(
      `http://localhost:${DEMO_PORT}/webhooks/stripe`,
      {
        id: `evt_stack_subscription_${Date.now()}`,
        type: 'customer.subscription.created',
        data: { object: { customer: co.customerId, status: 'active' } },
      },
      { 'stripe-signature': 'test' },
    );
    if (subscription.status !== 200) throw new Error('subscription webhook must return 200');

    let subscriptionViolated = false;
    for (let i = 0; i < 20; i++) {
      const r = await fetch(`http://localhost:${BACKEND_PORT}/api/v1/invariants?pageSize=20`, {
        headers: apiHeaders,
      });
      const data = (await r.json()) as any;
      const invariant = data.data?.find((v: any) => v.id === 'inv-stripe-subscription-activation');
      if (invariant?.status === 'VIOLATED') {
        subscriptionViolated = true;
        break;
      }
      await new Promise(r2 => setTimeout(r2, 500));
    }
    console.log('subscription activation invariant violated:', subscriptionViolated);
    if (!subscriptionViolated) throw new Error('subscription.activation_failed did not violate its invariant');

    console.log('STACK CHECK OK');
  } finally {
    for (const child of children) child.kill();
    await app.close();
  }
}

main().then(
  () => process.exit(0),
  e => {
    console.error('STACK CHECK FAILED:', e);
    process.exit(1);
  },
);
