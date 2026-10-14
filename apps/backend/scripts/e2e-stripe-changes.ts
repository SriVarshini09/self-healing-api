// End-to-end: the Stripe change monitor through the real webhook route.
// Five invoice.payment_succeeded webhooks on API version 2024-06-20, then one on
// 2025-03-31.basil where invoice.subscription moved to
// invoice.parent.subscription_details.subscription (modeled on Stripe's basil
// change). Expects: one API-version change plus "data.object.subscription is no
// longer sent", flagged as read by an outcome check, in ONE HIGH incident with
// one Slack alert; no repeats for later events or a late retry of an old event;
// a later type change joins the same incident. Slack calls are intercepted.
// Run: pnpm --filter @shapi/backend e2e:stripe-changes
process.env.ALERT_WEBHOOK_URL = '';

type Captured = { url: string; body: Record<string, unknown> };
const captured: Captured[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('https://hooks.slack.com/')) {
    captured.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response('ok', { status: 200 });
  }
  return realFetch(input, init);
}) as typeof fetch;

const { default: Fastify } = await import('fastify');
const { registerPlugins } = await import('../src/plugins/index.js');
const { registerRoutes } = await import('../src/routes/index.js');
const { prisma } = await import('../src/utils/prisma.js');
const { deliverPendingAlerts } = await import('../src/services/alerts.js');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ok - ${message}`);
}

const app = Fastify();
await registerPlugins(app);
await registerRoutes(app);
await app.ready();
const auth = { 'x-api-key': process.env.SHAPI_API_KEY || 'shapi_demo_local_d3v_k3y_9f2c' };
const json = (r: { body: string }) => JSON.parse(r.body);
const soon = () => new Date(Date.now() + 1000);
const runId = Date.now();
const slackUrl = `https://hooks.slack.com/services/T0000/B0000/changes${runId}`;
const OLD = '2024-06-20';
const BASIL = '2025-03-31.basil';

let n = 0;
function invoice(version: string, options: { moved?: boolean; expandCustomer?: boolean } = {}) {
  n++;
  const object: Record<string, unknown> = {
    id: `in_${runId}_${n}`, object: 'invoice', customer: options.expandCustomer ? { id: 'cus_e2e', object: 'customer' } : 'cus_e2e',
    amount_paid: 4900, status: 'paid', metadata: {},
    lines: { object: 'list', data: [{ id: `il_${n}`, price: { id: 'price_e2e', product: 'prod_e2e' } }] },
  };
  if (options.moved) object.parent = { subscription_details: { subscription: 'sub_e2e' } };
  else object.subscription = 'sub_e2e';
  return { id: `evt_chg_${runId}_${n}`, object: 'event', type: 'invoice.payment_succeeded', api_version: version, created: Math.floor(Date.now() / 1000), data: { object } };
}

let integrationId = '';
async function send(event: ReturnType<typeof invoice>) {
  const response = await app.inject({
    method: 'POST', url: '/api/v1/webhooks/stripe',
    headers: { 'content-type': 'application/json', 'stripe-signature': 'test' }, payload: event,
  });
  if (response.statusCode !== 200) throw new Error(`webhook returned ${response.statusCode}`);
  const stored = await prisma.webhookEvent.findFirst({ where: { providerEventId: event.id } });
  if (stored?.integrationId !== integrationId) throw new Error('test event was routed to a different Stripe integration');
}
/** The monitor runs after the webhook replies; wait until it has seen `samples` events. */
async function settled(samples: number) {
  for (let i = 0; i < 100; i++) {
    const shape = await prisma.stripeEventShape.findUnique({ where: { integrationId_eventType: { integrationId, eventType: 'invoice.payment_succeeded' } } });
    if ((shape?.samples ?? 0) >= samples) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`monitor did not observe ${samples} events`);
}
const changes = () => prisma.stripeChange.findMany({ where: { integrationId }, orderBy: { detectedAt: 'asc' } });
const slackCalls = () => captured.filter(call => call.url === slackUrl);
const created: { destinationId?: string; checkId?: string } = {};

async function resetMonitor() {
  await prisma.incident.deleteMany({ where: { stripeChanges: { some: { integrationId } } } });
  await prisma.stripeChange.deleteMany({ where: { integrationId } });
  await prisma.stripeEventShape.deleteMany({ where: { integrationId } });
  await prisma.integration.update({ where: { id: integrationId }, data: { providerApiVersion: null } });
}

try {
  console.log('1. setup');
  const integrations = json(await app.inject({ method: 'GET', url: '/api/v1/integrations?pageSize=100', headers: auth })).data as Array<{ id: string; type: string }>;
  integrationId = integrations.find(item => item.type === 'STRIPE')?.id ?? '';
  if (!integrationId) throw new Error('seeded Stripe integration missing');
  await resetMonitor(); // this test owns the monitor state of the seeded test integration
  const destination = await app.inject({ method: 'POST', url: '/api/v1/alerts/destinations', headers: auth, payload: { kind: 'SLACK', name: '#stripe-changes', slackWebhookUrl: slackUrl } });
  created.destinationId = json(destination).id;
  const check = await app.inject({ method: 'POST', url: '/api/v1/outcome-checks', headers: auth, payload: {
    integrationId, name: `Subscription active ${runId}`, triggerEventType: 'invoice.payment_succeeded',
    sql: 'SELECT 1 FROM subscriptions WHERE stripe_subscription_id = :sub', paramBindings: { sub: 'data.object.subscription' },
    deadlineSec: 300, databaseUrl: (process.env.DATABASE_URL ?? '').split('?')[0], enabled: true,
  } });
  assert(check.statusCode === 201, 'outcome check reading data.object.subscription created');
  created.checkId = json(check).id;

  console.log('2. learn the current shape');
  for (let i = 0; i < 5; i++) await send(invoice(OLD));
  await settled(5);
  assert((await changes()).length === 0, 'five consistent events: no changes reported');
  assert((await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } })).providerApiVersion === OLD, `API version recorded as ${OLD}`);

  console.log('3. Stripe upgrades the webhook API version');
  await send(invoice(BASIL, { moved: true }));
  await settled(6);
  const afterUpgrade = await changes();
  const version = afterUpgrade.find(change => change.kind === 'API_VERSION');
  const removed = afterUpgrade.find(change => change.kind === 'FIELD_REMOVED');
  assert(version?.before === OLD && version.after === BASIL, 'API version change recorded');
  assert(removed?.path === 'data.object.subscription' && removed.before === 'string', 'data.object.subscription reported as no longer sent');
  assert(removed?.affectedCheckIds.includes(created.checkId!), 'flagged as read by the outcome check');
  assert(afterUpgrade.length === 2, `exactly these two changes (got ${afterUpgrade.map(change => change.path ?? change.kind).join(', ')})`);
  const incidents = [...new Set(afterUpgrade.map(change => change.incidentId))];
  assert(incidents.length === 1 && incidents[0], 'both changes in one incident');
  const incident = await prisma.incident.findUniqueOrThrow({ where: { id: incidents[0]! } });
  assert(incident.severity === 'HIGH' && incident.title === `Stripe API version changed to ${BASIL}`, `HIGH incident "${incident.title}"`);
  assert(incident.description.includes('data.object.subscription is no longer sent') && incident.description.includes(`Subscription active ${runId}`), 'incident names the field and the check that reads it');

  console.log('4. one alert');
  await deliverPendingAlerts(soon());
  assert(slackCalls().length === 1 && JSON.stringify(slackCalls()[0].body).includes('Stripe API version changed'), 'one Slack message');

  console.log('5. no repeats');
  await send(invoice(BASIL, { moved: true }));
  await send(invoice(OLD)); // a late retry of a pre-upgrade event: not counted as a sample
  // Observations queue on a row lock in arrival order, so once this sentinel is
  // counted the retry has been handled too.
  await send(invoice(BASIL, { moved: true }));
  await settled(8);
  const shape = await prisma.stripeEventShape.findUniqueOrThrow({ where: { integrationId_eventType: { integrationId, eventType: 'invoice.payment_succeeded' } } });
  assert(shape.samples === 8, 'the old-version retry was not learned from');
  assert((await changes()).length === 2, 'later events and a late old-version retry add nothing');
  assert((await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } })).providerApiVersion === BASIL, 'API version stays on the newer version');

  console.log('6. a later change joins the same incident');
  for (let i = 0; i < 3; i++) await send(invoice(BASIL, { moved: true }));
  await settled(11);
  await send(invoice(BASIL, { moved: true, expandCustomer: true }));
  await settled(12);
  const all = await changes();
  const retyped = all.find(change => change.kind === 'TYPE_CHANGED');
  assert(retyped?.path === 'data.object.customer' && retyped.before === 'string' && retyped.after === 'object', 'customer id -> expanded object reported');
  assert(new Set(all.map(change => change.incidentId)).size === 1, 'joined the open incident');
  await deliverPendingAlerts(soon());
  assert(slackCalls().length === 1, 'no second alert for the same burst');

  console.log('7. API');
  const listed = json(await app.inject({ method: 'GET', url: `/api/v1/stripe-changes?incidentId=${incident.id}`, headers: auth }));
  assert(listed.data.length === 3, 'GET /stripe-changes lists the incident changes');
  assert(listed.data.some((change: { affectedChecks: Array<{ name: string }>; summary: string }) =>
    change.affectedChecks.some(check => check.name === `Subscription active ${runId}`) && change.summary.includes('is no longer sent')), 'with readable summaries and the affected check');
  assert(listed.apiVersions.some((entry: { integrationId: string; apiVersion: string }) => entry.integrationId === integrationId && entry.apiVersion === BASIL), 'current API version per connection');
  const unauth = await app.inject({ method: 'GET', url: '/api/v1/stripe-changes' });
  assert(unauth.statusCode === 401, 'requires authentication');
  console.log('\nE2E STRIPE CHANGES OK');
} finally {
  if (created.destinationId) await prisma.alertDestination.deleteMany({ where: { id: created.destinationId } });
  if (created.checkId) await app.inject({ method: 'DELETE', url: `/api/v1/outcome-checks/${created.checkId}`, headers: auth });
  if (integrationId) await resetMonitor();
  await app.close();
  await prisma.$disconnect();
}
