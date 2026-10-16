// End-to-end: Slack + email alert destinations on a real outcome-check incident.
// Outbound calls to hooks.slack.com and api.resend.com are intercepted, so
// nothing leaves the machine. Checks: validation, test alert, one alert per
// incident per destination (no duplicates), the stuck customer named in the
// message, a link to the incident, and a "resolved" message on resolve.
// Run: pnpm --filter @shapi/backend e2e:alerts
process.env.RESEND_API_KEY = 're_e2e_not_real';
process.env.ALERT_EMAIL_FROM = 'SHAPI <alerts@example.com>';
process.env.ALERT_WEBHOOK_URL = '';

type Captured = { url: string; body: Record<string, unknown> };
const captured: Captured[] = [];
// Scripted failures per URL: each call shifts the next status off the list (then 200).
const scripted: Record<string, number[]> = {};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = String(input instanceof Request ? input.url : input);
  if (scripted[url]?.length) return new Response('scripted failure', { status: scripted[url].shift()! });
  if (url.startsWith('https://hooks.slack.com/') || url.startsWith('https://api.resend.com/')) {
    captured.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response('ok', { status: 200 });
  }
  return realFetch(input, init);
}) as typeof fetch;

const { default: Fastify } = await import('fastify');
const { default: pg } = await import('pg');
const { registerPlugins } = await import('../src/plugins/index.js');
const { registerRoutes } = await import('../src/routes/index.js');
const { prisma } = await import('../src/utils/prisma.js');
const { processDueOutcomeRuns } = await import('../src/services/outcome-checks.js');
const { deliverPendingAlerts, enqueueIncidentAlert } = await import('../src/services/alerts.js');

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
// Prisma can stamp nextAttemptAt ~1ms after the insert returns, so a pass run
// immediately after queueing may skip the newest row. The scheduler picks it up
// on its next tick in production; here, look slightly ahead instead.
const soon = () => new Date(Date.now() + 1000);
const dbUrl = (process.env.OUTCOME_E2E_DATABASE_URL || process.env.DATABASE_URL!).split('?')[0];
const db = new pg.Client({ connectionString: dbUrl });
await db.connect();
const runId = Date.now();
const slackUrl = `https://hooks.slack.com/services/T0000/B0000/e2e${runId}`;
const created: { destinations: string[]; checkId?: string; incidentId?: string } = { destinations: [] };
// Other incidents (e.g. the demo's seeded rules) may alert too; count only this run's incident.
let incidentLink = '';
const forIncident = (call: Captured) => !incidentLink || JSON.stringify(call.body).includes(incidentLink);
const slackCalls = () => captured.filter(call => call.url === slackUrl && forIncident(call));
const emailCalls = () => captured.filter(call => call.url.startsWith('https://api.resend.com/') && JSON.stringify(call.body).includes(`alerts-${runId}@example.com`) && forIncident(call));

try {
  console.log('1. destinations');
  const bad = await app.inject({ method: 'POST', url: '/api/v1/alerts/destinations', headers: auth, payload: { kind: 'SLACK', name: 'Evil', slackWebhookUrl: 'https://evil.example/services/x' } });
  assert(bad.statusCode === 400 && /hooks\.slack\.com/.test(json(bad).error), 'non-Slack URL is refused');
  const slack = await app.inject({ method: 'POST', url: '/api/v1/alerts/destinations', headers: auth, payload: { kind: 'SLACK', name: '#payments', slackWebhookUrl: slackUrl } });
  assert(slack.statusCode === 201 && !slack.body.includes(slackUrl), 'Slack destination saved; URL never returned');
  created.destinations.push(json(slack).id);
  const email = await app.inject({ method: 'POST', url: '/api/v1/alerts/destinations', headers: auth, payload: { kind: 'EMAIL', name: 'Founders', emails: [`alerts-${runId}@example.com`] } });
  assert(email.statusCode === 201, 'email destination saved');
  created.destinations.push(json(email).id);
  const list = json(await app.inject({ method: 'GET', url: '/api/v1/alerts/destinations', headers: auth }));
  assert(list.emailAvailable === true && list.data.filter((d: { id: string }) => created.destinations.includes(d.id)).length === 2, 'both listed; email available');

  console.log('2. test alert');
  const test = await app.inject({ method: 'POST', url: `/api/v1/alerts/destinations/${created.destinations[0]}/test`, headers: auth });
  assert(test.statusCode === 200 && slackCalls().length === 1 && JSON.stringify(slackCalls()[0].body).includes('test alert'), 'test alert reaches Slack');
  captured.length = 0;

  console.log('3. a real outcome-check incident');
  await db.query('DROP TABLE IF EXISTS e2e_alert_users');
  await db.query('CREATE TABLE e2e_alert_users (stripe_customer_id text PRIMARY KEY)');
  // The API key's own workspace: pick its Stripe integration through the tenant-scoped API.
  const integrations = json(await app.inject({ method: 'GET', url: '/api/v1/integrations?pageSize=100', headers: auth })).data as Array<{ id: string; type: string }>;
  const integration = integrations.find(item => item.type === 'STRIPE');
  if (!integration) throw new Error('seeded Stripe integration missing');
  const check = await app.inject({ method: 'POST', url: '/api/v1/outcome-checks', headers: auth, payload: {
    integrationId: integration.id, name: `Alert e2e ${runId}`, triggerEventType: 'invoice.payment_succeeded',
    sql: 'SELECT 1 FROM e2e_alert_users WHERE stripe_customer_id = :customer', paramBindings: { customer: 'data.object.customer' },
    deadlineSec: 30, databaseUrl: dbUrl,
  } });
  created.checkId = json(check).id;
  await app.inject({ method: 'POST', url: '/api/v1/webhooks/stripe', headers: { 'content-type': 'application/json', 'stripe-signature': 'test' },
    payload: { id: `evt_alert_${runId}`, object: 'event', type: 'invoice.payment_succeeded', created: Math.floor(Date.now() / 1000), data: { object: { customer: 'cus_alert_stuck', amount_paid: 4900, status: 'paid' } } } });
  for (let i = 0; i < 50 && !(await prisma.outcomeCheckRun.count({ where: { checkId: created.checkId } })); i++) await new Promise(r => setTimeout(r, 100));
  await processDueOutcomeRuns(new Date(Date.now() + 31_000));
  const incident = await prisma.incident.findFirst({ where: { invariantId: `outcome-${created.checkId}` } });
  assert(incident, 'paid-but-not-provisioned incident opened');
  created.incidentId = incident.id;
  incidentLink = `/#/incidents/${incident.id}`;

  console.log('4. alerts delivered once each');
  await deliverPendingAlerts(soon());
  assert(slackCalls().length === 1, 'one Slack message');
  assert(emailCalls().length === 1, 'one email');
  const slackText = JSON.stringify(slackCalls()[0].body);
  assert(slackText.includes('cus_alert_stuck') && slackText.includes(`evt_alert_${runId}`), 'Slack message names the customer and the Stripe event');
  assert(slackText.includes(`/#/incidents/${incident.id}`), 'Slack message links to the incident');
  assert(String(emailCalls()[0].body.subject).startsWith('[SHAPI] Incident: Alert e2e'), 'email subject is readable');
  await deliverPendingAlerts(new Date(Date.now() + 60_000));
  assert(slackCalls().length === 1 && emailCalls().length === 1, 'no duplicate alerts on the next pass');

  console.log('5. resolved');
  await app.inject({ method: 'PATCH', url: `/api/v1/incidents/${incident.id}`, headers: auth, payload: { status: 'RESOLVED' } });
  await deliverPendingAlerts(soon());
  assert(slackCalls().length === 2 && JSON.stringify(slackCalls()[1].body).includes('Resolved: '), 'Slack gets a "resolved" message');
  assert(emailCalls().length === 2, 'email gets a "resolved" message');
  const deliveries = await prisma.alertDelivery.findMany({ where: { incidentId: incident.id } });
  assert(deliveries.length === 4 && deliveries.every(d => d.status === 'DELIVERED'), 'outbox shows 4 delivered (2 destinations x detected/resolved)');
  console.log('6. a provider blip does not lose the alert');
  const flakyUrl = `https://hooks.slack.com/services/T0000/B0000/flaky${runId}`;
  const goneUrl = `https://hooks.slack.com/services/T0000/B0000/gone${runId}`;
  scripted[flakyUrl] = [503];
  scripted[goneUrl] = [404];
  const flaky = json(await app.inject({ method: 'POST', url: '/api/v1/alerts/destinations', headers: auth, payload: { kind: 'SLACK', name: '#flaky', slackWebhookUrl: flakyUrl } }));
  const gone = json(await app.inject({ method: 'POST', url: '/api/v1/alerts/destinations', headers: auth, payload: { kind: 'SLACK', name: '#gone', slackWebhookUrl: goneUrl } }));
  created.destinations.push(flaky.id, gone.id);
  await enqueueIncidentAlert(incident.id, 'detected');
  const t0 = soon();
  await deliverPendingAlerts(t0);
  const flakyDelivery = await prisma.alertDelivery.findFirstOrThrow({ where: { incidentId: incident.id, channel: `dest:${flaky.id}:detected` } });
  assert(flakyDelivery.status === 'RETRYING' && flakyDelivery.attempts === 1, 'a 503 from Slack schedules a retry instead of giving up');
  const wait = flakyDelivery.nextAttemptAt.getTime() - t0.getTime();
  assert(wait >= 14_000 && wait <= 16_000, `the retry is about 15 seconds out, not 1 second (got ${wait} ms)`);
  await deliverPendingAlerts(new Date(t0.getTime() + 20_000));
  const retried = await prisma.alertDelivery.findUniqueOrThrow({ where: { id: flakyDelivery.id } });
  assert(retried.status === 'DELIVERED' && retried.attempts === 2, 'and the retry delivers the alert');
  const goneDelivery = await prisma.alertDelivery.findFirstOrThrow({ where: { incidentId: incident.id, channel: `dest:${gone.id}:detected` } });
  assert(goneDelivery.status === 'FAILED' && goneDelivery.attempts === 1 && /404/.test(goneDelivery.lastError ?? ''), 'a 404 (removed webhook) fails at once with the reason, no pointless retries');

  console.log('\nE2E ALERTS OK');
} finally {
  for (const id of created.destinations) await prisma.alertDestination.deleteMany({ where: { id } });
  if (created.incidentId) await prisma.incident.deleteMany({ where: { id: created.incidentId } });
  if (created.checkId) await app.inject({ method: 'DELETE', url: `/api/v1/outcome-checks/${created.checkId}`, headers: auth });
  await db.query('DROP TABLE IF EXISTS e2e_alert_users').catch(() => undefined);
  await db.end();
  await app.close();
  await prisma.$disconnect();
}
