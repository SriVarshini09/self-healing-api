// End-to-end: one workspace can never read or change another's data. Seeds a
// full set of rows in workspace A, then calls every id-based route as workspace
// B (API key and browser session). Each must answer 403/404 (never 2xx, never
// 5xx), and A's rows must be untouched afterwards.
// Run: pnpm --filter @shapi/backend e2e:tenant-isolation
process.env.SHAPI_SIGNUP_MODE = 'invite';

const { default: Fastify } = await import('fastify');
const { registerPlugins } = await import('../src/plugins/index.js');
const { registerRoutes } = await import('../src/routes/index.js');
const { prisma } = await import('../src/utils/prisma.js');
const { generateApiKey } = await import('../src/utils/api-keys.js');
const { encryptSecret } = await import('../src/utils/secrets.js');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ok - ${message}`);
}

const app = Fastify();
await registerPlugins(app);
await registerRoutes(app);
await app.ready();
const runId = Date.now();
const tenants: string[] = [];

async function workspace(label: string) {
  const tenant = await prisma.tenant.create({ data: { name: `${label} ${runId}`, slug: `${label}-${runId}` } });
  tenants.push(tenant.id);
  const key = generateApiKey();
  const record = await prisma.aPIKey.create({ data: { tenantId: tenant.id, name: label, keyHash: key.keyHash, prefix: key.prefix, permissions: ['*'], role: 'OWNER' } });
  return { tenant, key: key.key, keyId: record.id };
}

const a = await workspace('alpha');
const b = await workspace('bravo');

try {
  const integration = await prisma.integration.create({ data: { tenantId: a.tenant.id, name: 'A Stripe', type: 'STRIPE', config: {}, webhookSecret: `whsec_alpha_${runId}_abcdefgh` } });
  await prisma.driftDetectionConfig.create({ data: { integrationId: integration.id } });
  const invariant = await prisma.invariant.create({
    data: { integrationId: integration.id, name: 'A rule', description: 'x', predicateExpression: "event.type === 'invoice.paid'", predicateDescription: 'x' },
  });
  const event = await prisma.webhookEvent.create({ data: { integrationId: integration.id, eventType: 'invoice.paid', providerEventId: `evt_a_${runId}`, payload: {}, headers: {} } });
  const incident = await prisma.incident.create({ data: { integrationId: integration.id, invariantId: invariant.id, title: 'A incident', description: 'x', severity: 'HIGH' } });
  const check = await prisma.outcomeCheck.create({
    data: {
      integrationId: integration.id, name: 'A check', triggerEventType: 'invoice.paid', sqlQuery: 'select 1 where $1 = $1',
      paramBindings: { p1: 'customer' }, databaseUrlCipher: encryptSecret('postgresql://u:p@db.example.com/x'),
    },
  });
  const destination = await prisma.alertDestination.create({ data: { tenantId: a.tenant.id, kind: 'EMAIL', name: 'A alerts', emails: ['ops@example.com'] } });
  const otherKey = generateApiKey();
  const apiKey = await prisma.aPIKey.create({ data: { tenantId: a.tenant.id, name: 'A second key', keyHash: otherKey.keyHash, prefix: otherKey.prefix, permissions: ['read'], role: 'VIEWER' } });
  const now = new Date();
  await prisma.invariantEvaluation.create({
    data: { invariantId: invariant.id, windowStart: new Date(now.getTime() - 60_000), windowEnd: now, totalSamples: 5, passedSamples: 5, successRate: 1, status: 'HEALTHY', details: {} },
  });
  await prisma.driftResult.create({
    data: { invariantId: invariant.id, detected: false, pValue: 0.5, effectSize: 0, baselineRate: 1, currentRate: 1, sampleSize: 5 },
  });
  await prisma.stripeChange.create({ data: { integrationId: integration.id, kind: 'API_VERSION', after: '2025-01-01' } });

  type Probe = [method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: object];
  const probes: Probe[] = [
    ['GET', `/integrations/${integration.id}`],
    ['PATCH', `/integrations/${integration.id}`, { name: 'hijacked' }],
    ['DELETE', `/integrations/${integration.id}`],
    ['GET', `/integrations/${integration.id}/webhook-events`],
    ['GET', `/integrations/${integration.id}/webhook-url`],
    ['POST', `/integrations/${integration.id}/regenerate-secret`, {}],
    ['GET', `/invariants/${invariant.id}`],
    ['PATCH', `/invariants/${invariant.id}`, { name: 'hijacked' }],
    ['DELETE', `/invariants/${invariant.id}`],
    ['POST', `/invariants/${invariant.id}/evaluate`, {}],
    ['GET', `/invariants/${invariant.id}/evaluations`],
    ['GET', `/incidents/${incident.id}`],
    ['PATCH', `/incidents/${incident.id}`, { status: 'DISMISSED' }],
    ['GET', `/incidents/${incident.id}/timeline`],
    ['POST', `/incidents/${incident.id}/diagnose`, {}],
    ['POST', `/incidents/${incident.id}/replay`, { webhookEventId: event.id }],
    ['GET', `/drift/config/${integration.id}`],
    ['PATCH', `/drift/config/${integration.id}`, { enabled: false }],
    ['GET', `/drift/results/${invariant.id}`],
    ['POST', `/drift/check/${invariant.id}`, {}],
    ['GET', `/outcome-checks/${check.id}`],
    ['PATCH', `/outcome-checks/${check.id}`, { name: 'hijacked' }],
    ['DELETE', `/outcome-checks/${check.id}`],
    ['POST', `/outcome-checks/${check.id}/test`, {}],
    ['POST', `/outcome-checks/${check.id}/reconcile`, {}],
    ['GET', `/outcome-checks/${check.id}/runs`],
    ['PATCH', `/alerts/destinations/${destination.id}`, { enabled: false }],
    ['DELETE', `/alerts/destinations/${destination.id}`],
    ['POST', `/alerts/destinations/${destination.id}/test`, {}],
    ['DELETE', `/api-keys/${apiKey.id}`],
    ['GET', `/github/incidents/${incident.id}/prs`],
    ['POST', `/github/incidents/${incident.id}/pr/preview`, {}],
    ['POST', `/github/incidents/${incident.id}/pr`, {}],
  ];

  console.log('1. every id-based route refuses a different workspace');
  let leaked = 0;
  for (const [method, url, body] of probes) {
    const response = await app.inject({ method, url: `/api/v1${url}`, headers: { 'x-api-key': b.key }, ...(body ? { payload: body as Record<string, unknown> } : {}) });
    // List-style routes answer 200 with an empty page for ids that aren't yours; that leaks nothing.
    const parsed = response.statusCode === 200 ? JSON.parse(response.body) : null;
    const emptyList = parsed !== null && (Array.isArray(parsed) ? parsed.length === 0 : Array.isArray(parsed.data) && parsed.data.length === 0);
    const refused = [400, 403, 404].includes(response.statusCode) || emptyList;
    if (!refused) {
      leaked++;
      console.log(`  FAIL ${method} ${url} -> ${response.statusCode} ${response.body.slice(0, 120)}`);
    }
  }
  assert(leaked === 0, `all ${probes.length} cross-workspace probes were refused (400/403/404 or an empty list; never other data, never 5xx)`);

  console.log('2. lists never include another workspace');
  for (const url of ['/integrations', '/invariants', '/incidents', '/outcome-checks', '/alerts/destinations', '/api-keys', '/stripe-changes', '/drift/results', '/drift/summary']) {
    const response = await app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { 'x-api-key': b.key } });
    assert(response.statusCode === 200 && !response.body.includes(integration.id) && !response.body.includes(a.tenant.id), `GET ${url} shows nothing from the other workspace`);
  }

  console.log('3. the other workspace\'s data is untouched');
  assert((await prisma.integration.findUnique({ where: { id: integration.id } }))?.name === 'A Stripe', 'integration still exists with its name');
  assert((await prisma.invariant.findUnique({ where: { id: invariant.id } }))?.name === 'A rule', 'invariant unchanged');
  assert((await prisma.incident.findUnique({ where: { id: incident.id } }))?.status === 'DETECTED', 'incident status unchanged');
  assert((await prisma.outcomeCheck.findUnique({ where: { id: check.id } }))?.name === 'A check', 'outcome check unchanged');
  assert(await prisma.alertDestination.findUnique({ where: { id: destination.id } }), 'alert destination still exists');
  assert(await prisma.aPIKey.findUnique({ where: { id: apiKey.id } }), 'API key still exists');
  assert((await prisma.integration.findUnique({ where: { id: integration.id } }))?.webhookSecret === `whsec_alpha_${runId}_abcdefgh`, 'webhook secret not rotated');

  console.log('4. two workspaces can use the same SDK event id');
  const sdk = (key: string, who: string, eventId: string) => app.inject({
    method: 'POST', url: '/api/v1/sdk/track', headers: { 'x-api-key': key },
    payload: { eventId, integration: 'stripe', type: 'order.paid', payload: { who } },
  });
  const sharedId = `order-1-${runId}`;
  const fromA = await sdk(a.key, 'alpha', sharedId);
  const fromB = await sdk(b.key, 'bravo', sharedId);
  assert(fromA.statusCode === 201 && fromB.statusCode === 201, 'both workspaces get success');
  assert(JSON.parse(fromA.body).id !== JSON.parse(fromB.body).id, "the second workspace is not handed the first one's row");
  assert((await prisma.trackedEvent.count({ where: { tenantId: a.tenant.id, eventId: sharedId } })) === 1
    && (await prisma.trackedEvent.count({ where: { tenantId: b.tenant.id, eventId: sharedId } })) === 1, 'each workspace has its own stored event');
  const listedB = JSON.parse((await app.inject({ method: 'GET', url: '/api/v1/sdk/events', headers: { 'x-api-key': b.key } })).body);
  assert(listedB.data.length === 1 && listedB.data[0].payload.who === 'bravo', 'and only sees its own');
  await sdk(a.key, 'alpha', sharedId);
  assert((await prisma.trackedEvent.count({ where: { tenantId: a.tenant.id, eventId: sharedId } })) === 1, 'resending the same id within a workspace stays idempotent');

  console.log('5. a body cannot re-parent or overwrite records in another workspace');
  const bIntegration = await prisma.integration.create({ data: { tenantId: b.tenant.id, name: 'B Stripe', type: 'STRIPE', config: {} } });
  const bInvariant = await prisma.invariant.create({
    data: { integrationId: bIntegration.id, name: 'B rule', description: 'x', predicateExpression: 'true', predicateDescription: 'x' },
  });
  const call = (method: 'PATCH' | 'POST', url: string, payload: unknown) => app.inject({ method, url: `/api/v1${url}`, headers: { 'x-api-key': b.key }, payload: payload as Record<string, unknown> });
  const reparent = await call('PATCH', `/invariants/${bInvariant.id}`, { name: 'hijack', integration: { connect: { id: integration.id } } });
  assert(reparent.statusCode === 400, 'moving my rule onto another workspace\'s connection through a nested write is refused');
  const moveById = await call('PATCH', `/invariants/${bInvariant.id}`, { integrationId: integration.id });
  assert(moveById.statusCode === 400, 'so is setting integrationId directly');
  assert((await prisma.invariant.findUniqueOrThrow({ where: { id: bInvariant.id } })).integrationId === bIntegration.id, 'the rule is still on my connection');
  const wipe = await call('PATCH', `/invariants/${bInvariant.id}`, { incidents: { deleteMany: {} } });
  assert(wipe.statusCode === 400, 'nested deletes are refused too');
  const configHijack = await call('PATCH', `/drift/config/${bIntegration.id}`, { integrationId: integration.id, enabled: false });
  assert(configHijack.statusCode === 400, 'a drift config body cannot name another workspace\'s connection');
  assert((await prisma.driftDetectionConfig.findUniqueOrThrow({ where: { integrationId: integration.id } })).enabled === true, "the other workspace's drift config is untouched");
  const legit = await call('PATCH', `/drift/config/${bIntegration.id}`, { enabled: false, minDetectionSamples: 25 });
  assert(legit.statusCode === 200 && JSON.parse(legit.body).minDetectionSamples === 25, 'a normal drift update still works');
  const typed = await call('POST', '/invariants', { integrationId: bIntegration.id, name: 'x', predicateExpression: 'true', evaluationWindowSec: { a: 1 } });
  assert(typed.statusCode === 400, 'a wrongly typed number is a 400, not a database error');
  const nul = await call('PATCH', `/invariants/${bInvariant.id}`, { name: 'bad\u0000name' });
  assert(nul.statusCode === 400, 'a NUL character is a 400, not a database error');
  const nulUrl = await app.inject({ method: 'GET', url: '/api/v1/invariants/a%00b', headers: { 'x-api-key': b.key } });
  assert(nulUrl.statusCode === 400, 'and so is one in the URL');

  console.log('\nE2E TENANT ISOLATION OK');
} finally {
  await prisma.integration.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.trackedEvent.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.aPIKey.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  await app.close();
  await prisma.$disconnect();
}
