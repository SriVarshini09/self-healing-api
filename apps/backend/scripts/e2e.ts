import Fastify from 'fastify';
import { registerPlugins } from '../src/plugins/index.js';
import { registerRoutes } from '../src/routes/index.js';
import { prisma } from '../src/utils/prisma.js';

async function main() {
  const app = Fastify();
  await registerPlugins(app);
  await registerRoutes(app);
  await app.ready();

  const j = (r: any) => JSON.parse(r.body);
  const KEY = process.env.SHAPI_API_KEY || 'shapi_demo_local_d3v_k3y_9f2c';
  const auth = { 'x-api-key': KEY };

  // 1. health (public)
  const health = await app.inject({ method: 'GET', url: '/health' });
  console.log('health:', health.statusCode);
  if (health.statusCode !== 200) throw new Error('health failed');

  // 1b. auth enforcement: protected route without key must 401
  const noAuth = await app.inject({ method: 'GET', url: '/api/v1/invariants?pageSize=1' });
  console.log('no-key invariants:', noAuth.statusCode);
  if (noAuth.statusCode !== 401) throw new Error('expected 401 without x-api-key');
  const badKey = await app.inject({
    method: 'GET',
    url: '/api/v1/invariants?pageSize=1',
    headers: { 'x-api-key': 'shapi_wrong_key' },
  });
  if (badKey.statusCode !== 401) throw new Error('expected 401 with wrong x-api-key');

  // 2. list integrations (seeded)
  const integ = await app.inject({
    method: 'GET',
    url: '/api/v1/integrations?pageSize=10',
    headers: auth,
  });
  const integData = j(integ);
  console.log('integrations:', integData.data?.length);
  const stripe = integData.data.find((i: any) => i.type === 'STRIPE');
  if (!stripe) throw new Error('stripe integration missing');

  // 3. list invariants
  const inv = await app.inject({ method: 'GET', url: '/api/v1/invariants?pageSize=10', headers: auth });
  console.log('invariants:', j(inv).data?.length);

  // 4. Stripe webhook flow: good payment (200 OK + business success)
  const good = await app.inject({
    method: 'POST',
    url: '/api/v1/webhooks/stripe',
    headers: { 'content-type': 'application/json', 'stripe-signature': 'test' },
    payload: {
      id: 'evt_e2e_good',
      type: 'invoice.payment_succeeded',
      data: { object: { id: 'in_good', amount_paid: 2000, status: 'paid', customer: 'cus_e2e' } },
    },
  });
  console.log('good webhook:', good.statusCode, good.body.slice(0, 120));

  // 5. Stripe webhook flow: 200 OK but business failure (amount_paid=0 violates predicate shape used in test)
  const bad = await app.inject({
    method: 'POST',
    url: '/api/v1/webhooks/stripe',
    headers: { 'content-type': 'application/json', 'stripe-signature': 'test' },
    payload: {
      id: 'evt_e2e_bad',
      type: 'invoice.payment_succeeded',
      data: { object: { id: 'in_bad', amount_paid: 0, status: 'paid', customer: 'cus_e2e' } },
    },
  });
  console.log('bad webhook (still 200):', bad.statusCode);
  if (bad.statusCode !== 200) throw new Error('webhook should return 200 even for bad business payload');

  // 6. SDK track
  const track = await app.inject({
    method: 'POST',
    url: '/api/v1/sdk/track',
    headers: { 'content-type': 'application/json', ...auth },
    payload: {
      eventId: `e2e-${Date.now()}`,
      integration: 'STRIPE',
      type: 'provisioning.failed',
      payload: { customer: 'cus_e2e', reason: 'simulated bug' },
    },
  });
  console.log('sdk track:', track.statusCode);
  if (track.statusCode !== 201) throw new Error('sdk track failed: ' + track.body);

  // 7. drift summary + incidents endpoints reachable
  const summary = await app.inject({ method: 'GET', url: '/api/v1/drift/summary', headers: auth });
  console.log('drift summary:', summary.statusCode, summary.body.slice(0, 160));
  const incidents = await app.inject({ method: 'GET', url: '/api/v1/incidents?pageSize=5', headers: auth });
  console.log('incidents:', incidents.statusCode, 'count=', j(incidents).data?.length);

  // 8. verify a stored webhook event exists
  const count = await prisma.webhookEvent.count();
  console.log('webhookEvents in DB:', count);
  if (count < 2) throw new Error('expected webhook events persisted');

  await app.close();
  await prisma.$disconnect();
  console.log('E2E OK');
}

main().catch(async e => {
  console.error('E2E FAILED:', e);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});
