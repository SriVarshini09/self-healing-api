// End-to-end: the shared /webhooks/stripe endpoint must attribute every event to
// the integration whose secret really signed it, never to another tenant's.
// Regression for: an integration whose secret is a known placeholder skipped
// signature checking, and as the first candidate in the list it swallowed other
// tenants' real events (and, in production, unsigned requests were accepted).
// Run: pnpm --filter @shapi/backend e2e:webhook-isolation
process.env.SHAPI_SIGNUP_MODE = 'invite';

const { default: Fastify } = await import('fastify');
const { default: Stripe } = await import('stripe');
const { registerPlugins } = await import('../src/plugins/index.js');
const { registerRoutes } = await import('../src/routes/index.js');
const { prisma } = await import('../src/utils/prisma.js');
const { generateApiKey } = await import('../src/utils/api-keys.js');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ok - ${message}`);
}

const app = Fastify();
await registerPlugins(app);
await registerRoutes(app);
await app.ready();
const runId = Date.now();
const json = (r: { body: string }) => JSON.parse(r.body);
const stripe = new Stripe('sk_test_e2e_not_real');
const PLACEHOLDER = 'whsec_your_stripe_webhook_secret';
const realSecret = `whsec_${runId}e2erealsecretabcdefghijklmnop`;
const tenants: string[] = [];

async function tenantWithIntegration(label: string, webhookSecret: string) {
  const tenant = await prisma.tenant.create({ data: { name: `${label} ${runId}`, slug: `${label}-${runId}` } });
  tenants.push(tenant.id);
  const integration = await prisma.integration.create({ data: { tenantId: tenant.id, name: `${label} Stripe`, type: 'STRIPE', config: {}, webhookSecret } });
  const key = generateApiKey();
  await prisma.aPIKey.create({ data: { tenantId: tenant.id, name: label, keyHash: key.keyHash, prefix: key.prefix, permissions: ['*'], role: 'OWNER' } });
  return { tenant, integration, key: key.key };
}

const event = (id: string) => ({ id, object: 'event', type: 'invoice.paid', data: { object: { customer: 'cus_e2e' } } });
async function deliver(payload: object, secret: string | null) {
  const body = JSON.stringify(payload);
  const header = secret ? stripe.webhooks.generateTestHeaderString({ payload: body, secret }) : 'garbage';
  return app.inject({ method: 'POST', url: '/api/v1/webhooks/stripe', headers: { 'content-type': 'application/json', 'stripe-signature': header }, payload: body });
}
const owner = async (providerEventId: string) => (await prisma.webhookEvent.findFirst({ where: { providerEventId } }))?.integrationId;

const realNodeEnv = process.env.NODE_ENV;
try {
  console.log('1. a real event goes to the tenant whose secret signed it');
  // The placeholder tenant is created FIRST, so it is ahead in any candidate list.
  const lenient = await tenantWithIntegration('lenient', PLACEHOLDER);
  const victim = await tenantWithIntegration('victim', realSecret);
  const first = await deliver(event(`evt_iso_1_${runId}`), realSecret);
  assert(first.statusCode === 200, 'a correctly signed event is accepted');
  assert(await owner(`evt_iso_1_${runId}`) === victim.integration.id, "the event is recorded under the victim's integration, not the placeholder-secret one");
  assert((await prisma.webhookEvent.count({ where: { integrationId: lenient.integration.id } })) === 0, 'the placeholder-secret integration received nothing');

  console.log('2. production never skips signature checks');
  process.env.NODE_ENV = 'production';
  const unsigned = await deliver(event(`evt_iso_2_${runId}`), null);
  assert(unsigned.statusCode === 401, 'an unsigned request is rejected in production, even if a placeholder-secret integration exists');
  assert(await owner(`evt_iso_2_${runId}`) === undefined, 'and nothing is stored');
  const stillWorks = await deliver(event(`evt_iso_3_${runId}`), realSecret);
  assert(stillWorks.statusCode === 200 && await owner(`evt_iso_3_${runId}`) === victim.integration.id, 'real signed events still work in production');
  process.env.NODE_ENV = realNodeEnv;

  console.log('3. secrets cannot be set to placeholders or collide');
  const call = (method: 'POST' | 'PATCH', url: string, key: string, payload: object) =>
    app.inject({ method, url: `/api/v1${url}`, headers: { 'x-api-key': key }, payload: payload as Record<string, unknown> });
  process.env.NODE_ENV = 'production';
  const placeholder = await call('POST', '/integrations', victim.key, { name: 'p', type: 'stripe', webhookSecret: PLACEHOLDER });
  assert(placeholder.statusCode === 400, 'a placeholder webhook secret is refused in production');
  process.env.NODE_ENV = realNodeEnv;
  const tooShort = await call('POST', '/integrations', victim.key, { name: 's', type: 'stripe', webhookSecret: 'a' });
  assert(tooShort.statusCode === 400, 'a one-character webhook secret is refused');
  const clash = await call('POST', '/integrations', lenient.key, { name: 'c', type: 'stripe', webhookSecret: realSecret });
  assert(clash.statusCode === 409 && !JSON.stringify(json(clash)).includes(victim.tenant.id), 'reusing another workspace\'s secret is a clean 409 that reveals nothing');
  const own = await call('POST', '/integrations', victim.key, { name: 'o', type: 'stripe' });
  const patchClash = await call('PATCH', `/integrations/${json(own).id}`, victim.key, { webhookSecret: realSecret });
  assert(patchClash.statusCode === 409, 'changing a secret to one already in use is a clean 409, not a 500');

  console.log('4. an event that keeps crashing is given up on, not left "in progress" forever');
  const { recoverPendingWebhookEvents } = await import('../src/routes/webhooks.js');
  const stuck = await prisma.webhookEvent.create({
    data: {
      integrationId: victim.integration.id, eventType: 'invoice.paid', providerEventId: `evt_stuck_${runId}`, payload: {}, headers: {},
      status: 'PROCESSING', processedAt: new Date(Date.now() - 60 * 60 * 1000), retryCount: 5,
    },
  });
  await recoverPendingWebhookEvents();
  const after = await prisma.webhookEvent.findUnique({ where: { id: stuck.id } });
  assert(after?.status === 'FAILED' && /gave up/i.test(after.errorMessage ?? ''), 'a PROCESSING event past its retry limit is marked FAILED with a reason');

  console.log('\nE2E WEBHOOK ISOLATION OK');
} finally {
  process.env.NODE_ENV = realNodeEnv;
  if (tenants.length) {
    await prisma.integration.deleteMany({ where: { tenantId: { in: tenants } } });
    await prisma.aPIKey.deleteMany({ where: { tenantId: { in: tenants } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  }
  await app.close();
  await prisma.$disconnect();
}
