import express from 'express';
import { Shapi } from '@shapi/sdk';
import { applyProvisioningOutcome, type DemoUser } from './business-outcome.js';

const PORT = Number(process.env.DEMO_PORT ?? 3000);
const SHAPI_URL = process.env.SHAPI_URL ?? 'http://localhost:3001';
const SHAPI_KEY = process.env.SHAPI_API_KEY ?? 'shapi_demo_local_d3v_k3y_9f2c';

const shapi = new Shapi({ apiKey: SHAPI_KEY, apiUrl: SHAPI_URL, environment: 'development' });

// In-memory "database" for demo
const users = new Map<string, DemoUser>();
let failureMode = false; // when true, provisioning silently fails but webhook returns 200

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'demo-saas', failureMode, users: users.size });
});

// Admin toggle: simulate the silent business-logic bug
app.post('/admin/failure-mode', (req, res) => {
  const body = (req.body ?? {}) as { enabled?: unknown };
  failureMode = typeof body.enabled === 'boolean' ? body.enabled : true;
  res.json({ failureMode });
});

// Fake checkout: creates a pending user, then pretends Stripe will webhook us
app.post('/checkout', async (req, res) => {
  const { email, plan } = (req.body ?? {}) as { email?: unknown; plan?: unknown };
  if (typeof email !== 'string' || !email) return res.status(400).json({ error: 'email required' });
  const id = `cus_${Math.random().toString(36).slice(2, 10)}`;
  users.set(id, { id, email, plan: typeof plan === 'string' ? plan : 'pro', provisioned: false });
  await shapi.track('stripe', 'checkout.initiated', { customer: id, email, plan }).catch(() => undefined);
  res.status(201).json({ customerId: id, message: 'checkout created; awaiting Stripe webhook' });
});

// Stripe webhook receiver (demo SaaS side). Forwards to SHAPI backend too.
// Note: this demo receiver intentionally skips signature enforcement (it accepts
// the local 'test' signature); real HMAC verification lives in the SHAPI backend.
app.post('/webhooks/stripe', async (req, res) => {
  const event = (req.body ?? {}) as { type?: string; data?: { object?: Record<string, unknown> } } & Record<string, unknown>;
  const type = event.type ?? 'unknown';

  // Forward raw webhook to SHAPI backend for invariant evaluation
  try {
    await fetch(`${SHAPI_URL}/api/v1/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': 'test' },
      body: JSON.stringify(event),
    });
  } catch {
    // backend may be down in isolated demo; continue
  }

  const report = shapi.webhookReporter('stripe');

  if (type === 'invoice.payment_succeeded') {
    const stripeObject = event.data?.object ?? {};
    const customer = (stripeObject.customer ?? event.customer) as string | undefined;
    const amount = Number(stripeObject.amount_paid ?? event.amount_paid ?? 0);
    try {
      await report(
        type,
        // Full-fidelity payload: the SDK must capture the complete Stripe
        // envelope so SHAPI invariants evaluate the same shape as webhooks.
        // (Tracking a lossy subset here once caused a false payment violation.)
        { ...(event as Record<string, unknown>), customer, amount_paid: amount },
        async () => {
          // THE BUG: returns 200 OK but silently skips provisioning when failureMode is on.
          return applyProvisioningOutcome(users, customer, failureMode);
        },
      );
    } catch {
      // reporter already tracked provisioning.failed
    }
    // Always 200 — this is the point: HTTP success hides business failure
    return res.json({ received: true });
  }

  return res.json({ received: true, ignored: type });
});

app.get('/users', (_req, res) => {
  res.json([...users.values()]);
});

app.listen(PORT, () => {
  console.log(`demo-saas listening on http://localhost:${PORT} (failureMode=${failureMode})`);
});
