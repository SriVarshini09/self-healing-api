// End-to-end: deleting a workspace and the retention purge, with a real database.
// Checks: only the signed-in Owner can delete, the workspace name must be typed,
// everything that belongs to the workspace is really gone (including rows the
// schema only detaches: connections, tracked events, API keys), another
// workspace is untouched, the session is cleared; the retention purge removes
// old events and closed incidents but keeps what an open incident needs and
// anything recent.
// Run: pnpm --filter @shapi/backend e2e:delete-workspace
process.env.SHAPI_SIGNUP_MODE = 'invite';
process.env.SHAPI_SIGNUP_INVITE_CODE = 'e2e-invite-code-123';

const { default: Fastify } = await import('fastify');
const { registerPlugins } = await import('../src/plugins/index.js');
const { registerRoutes } = await import('../src/routes/index.js');
const { prisma } = await import('../src/utils/prisma.js');
const { purgeExpiredData } = await import('../src/services/retention.js');
const { generateApiKey } = await import('../src/utils/api-keys.js');
const { createInvite } = await import('../src/services/team.js');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ok - ${message}`);
}

const app = Fastify();
await registerPlugins(app);
await registerRoutes(app);
await app.ready();
const runId = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const json = (r: { body: string }) => JSON.parse(r.body);
const cookieOf = (response: { headers: Record<string, unknown> }) => String(response.headers['set-cookie'] ?? '').split(';')[0];
const call = (method: 'GET' | 'POST' | 'DELETE', url: string, headers: Record<string, string>, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
const tenants: string[] = [];
const integrations: string[] = [];

async function signup(who: string) {
  const name = `WS ${who} ${runId}`;
  const response = await call('POST', '/auth/signup', {}, { workspaceName: name, name: who, email: `${who}-${runId}@example.com`, password: 'owner-password-123', inviteCode: 'e2e-invite-code-123' });
  if (response.statusCode !== 201) throw new Error(`signup failed: ${response.body}`);
  const tenantId = json(response).workspace.id as string;
  tenants.push(tenantId);
  return { cookie: cookieOf(response), tenantId, name };
}

/** One connection with an event, an incident replaying it, a tracked event, an API key and an alert destination. */
async function seed(tenantId: string, label: string) {
  const integration = await prisma.integration.create({ data: { tenantId, name: `${label} Stripe`, type: 'STRIPE', config: {} } });
  integrations.push(integration.id);
  const event = await prisma.webhookEvent.create({
    data: { integrationId: integration.id, eventType: 'invoice.paid', providerEventId: `evt_${label}_${runId}`, payload: { email: 'customer@example.com' }, headers: {} },
  });
  const incident = await prisma.incident.create({
    data: { integrationId: integration.id, title: `${label} incident`, description: 'seeded', severity: 'HIGH' },
  });
  await prisma.replayJob.create({ data: { incidentId: incident.id, webhookEventId: event.id, fixCandidate: '' } });
  const tracked = await prisma.trackedEvent.create({
    data: { tenantId, eventId: `trk_${label}_${runId}`, integration: 'STRIPE', type: 'invoice.paid', payload: {} },
  });
  const key = generateApiKey();
  const apiKey = await prisma.aPIKey.create({ data: { tenantId, name: `${label} key`, keyHash: key.keyHash, prefix: key.prefix, permissions: ['*'], role: 'OWNER' } });
  await prisma.alertDestination.create({ data: { tenantId, kind: 'EMAIL', name: `${label} alerts`, emails: ['ops@example.com'] } });
  return { integration, event, incident, tracked, apiKey, key: key.key };
}
type Seeded = Awaited<ReturnType<typeof seed>>;

const counts = (tenantId: string, s: Seeded) => Promise.all([
  prisma.tenant.count({ where: { id: tenantId } }),
  prisma.user.count({ where: { tenantId } }),
  prisma.integration.count({ where: { id: s.integration.id } }),
  prisma.webhookEvent.count({ where: { id: s.event.id } }),
  prisma.incident.count({ where: { id: s.incident.id } }),
  prisma.trackedEvent.count({ where: { id: s.tracked.id } }),
  prisma.aPIKey.count({ where: { id: s.apiKey.id } }),
  prisma.alertDestination.count({ where: { tenantId } }),
]);

try {
  console.log('1. who can delete');
  const doomed = await signup('doomed');
  const survivor = await signup('survivor');
  const a = await seed(doomed.tenantId, 'doomed');
  const b = await seed(survivor.tenantId, 'survivor');

  const invite = await createInvite(doomed.tenantId, `admin-${runId}@example.com`, 'ADMIN', null);
  const adminSignup = await call('POST', '/auth/invites/accept', {}, { token: /token=([A-Za-z0-9_-]+)/.exec(invite.link)![1], name: 'Admin', password: 'admin-password-123' });
  const adminCookie = cookieOf(adminSignup);
  assert((await call('DELETE', '/workspace', { cookie: adminCookie }, { confirm: doomed.name })).statusCode === 403, 'an Admin cannot delete the workspace');
  assert((await call('DELETE', '/workspace', { 'x-api-key': a.key }, { confirm: doomed.name })).statusCode === 403, 'an API key cannot delete the workspace, even an Owner-role one');
  assert((await call('DELETE', '/workspace', {}, { confirm: doomed.name })).statusCode === 401, 'signed-out requests are refused');
  assert((await call('DELETE', '/workspace', { cookie: doomed.cookie }, { confirm: 'wrong name' })).statusCode === 400, 'a wrong confirmation name is refused');
  assert((await call('DELETE', '/workspace', { cookie: doomed.cookie }, {})).statusCode === 400, 'a missing confirmation is refused');
  assert((await counts(doomed.tenantId, a)).every(count => count > 0), 'nothing was deleted by the refused attempts');

  console.log('2. delete');
  const gone = await call('DELETE', '/workspace', { cookie: doomed.cookie }, { confirm: ` ${doomed.name} ` });
  assert(gone.statusCode === 204, 'the Owner deletes the workspace (surrounding spaces ignored)');
  assert(String(gone.headers['set-cookie'] ?? '').includes('Max-Age=0'), 'the session cookie is cleared');
  assert((await counts(doomed.tenantId, a)).every(count => count === 0), 'workspace, people, connection, events, incident, tracked events, API key and alert destinations are all gone');
  assert((await call('GET', '/auth/me', { cookie: doomed.cookie })).statusCode === 401, 'the old session no longer works');
  assert((await call('GET', '/workspace', { 'x-api-key': a.key })).statusCode === 401, 'the deleted workspace API key no longer works');
  assert((await call('GET', '/workspace', { cookie: adminCookie })).statusCode === 401, "the Admin's session is gone too");

  console.log('3. another workspace is untouched');
  assert((await counts(survivor.tenantId, b)).every(count => count > 0), 'the other workspace keeps everything');
  assert((await call('GET', '/workspace', { cookie: survivor.cookie })).statusCode === 200, 'and can still sign in and work');

  console.log('4. retention');
  const t = await signup('retention');
  const stale = new Date(Date.now() - 120 * DAY);
  const integration = await prisma.integration.create({ data: { tenantId: t.tenantId, name: 'Retention Stripe', type: 'STRIPE', config: {} } });
  integrations.push(integration.id);
  const mkEvent = (suffix: string, receivedAt: Date) => prisma.webhookEvent.create({
    data: { integrationId: integration.id, eventType: 'invoice.paid', providerEventId: `evt_ret_${suffix}_${runId}`, payload: {}, headers: {}, receivedAt },
  });
  const oldEvent = await mkEvent('old', stale);
  const recentEvent = await mkEvent('recent', new Date());
  const heldEvent = await mkEvent('held', stale);
  const openIncident = await prisma.incident.create({ data: { integrationId: integration.id, title: 'open', description: 'x', severity: 'LOW' } });
  await prisma.replayJob.create({ data: { incidentId: openIncident.id, webhookEventId: heldEvent.id, fixCandidate: '' } });
  const oldClosed = await prisma.incident.create({ data: { integrationId: integration.id, title: 'old closed', description: 'x', severity: 'LOW', status: 'RESOLVED' } });
  const oldOpen = await prisma.incident.create({ data: { integrationId: integration.id, title: 'old open', description: 'x', severity: 'LOW' } });
  // updatedAt is managed by Prisma, so backdate it with SQL.
  await prisma.$executeRaw`UPDATE "Incident" SET "updatedAt" = ${stale} WHERE id IN (${oldClosed.id}, ${oldOpen.id})`;
  const oldTracked = await prisma.trackedEvent.create({ data: { tenantId: t.tenantId, eventId: `trk_old_${runId}`, integration: 'STRIPE', type: 'x', payload: {}, timestamp: stale } });
  const newTracked = await prisma.trackedEvent.create({ data: { tenantId: t.tenantId, eventId: `trk_new_${runId}`, integration: 'STRIPE', type: 'x', payload: {} } });
  const user = await prisma.user.findFirstOrThrow({ where: { tenantId: t.tenantId } });
  await prisma.authSession.create({ data: { userId: user.id, sessionHash: `expired-${runId}`, expiresAt: new Date(Date.now() - DAY) } });
  await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: `expired-reset-${runId}`, expiresAt: new Date(Date.now() - DAY) } });

  const result = await purgeExpiredData(new Date(), 90);
  assert(!(await prisma.webhookEvent.findUnique({ where: { id: oldEvent.id } })), 'an event older than the retention is deleted');
  assert(await prisma.webhookEvent.findUnique({ where: { id: recentEvent.id } }), 'a recent event is kept');
  assert(await prisma.webhookEvent.findUnique({ where: { id: heldEvent.id } }), 'an old event that an open incident is replaying is kept');
  assert(!(await prisma.incident.findUnique({ where: { id: oldClosed.id } })), 'an old resolved incident is deleted');
  assert((await prisma.incident.findUnique({ where: { id: oldOpen.id } })) && (await prisma.incident.findUnique({ where: { id: openIncident.id } })), 'open incidents are kept however old');
  assert(!(await prisma.trackedEvent.findUnique({ where: { id: oldTracked.id } })) && (await prisma.trackedEvent.findUnique({ where: { id: newTracked.id } })), 'old tracked events go, recent ones stay');
  assert((await prisma.authSession.count({ where: { sessionHash: `expired-${runId}` } })) === 0, 'expired sessions are deleted');
  assert((await prisma.passwordResetToken.count({ where: { tokenHash: `expired-reset-${runId}` } })) === 0, 'expired reset links are deleted');
  assert(result.webhookEvents >= 1 && result.incidents >= 1 && result.trackedEvents >= 1, 'the purge reports what it removed');
  assert((await call('GET', '/auth/me', { cookie: t.cookie })).statusCode === 200, 'live sessions are not affected');
  assert(json(await call('GET', '/trust', {})).retentionDays === 90, 'the public trust page states the retention');

  console.log('\nE2E DELETE WORKSPACE OK');
} finally {
  if (integrations.length) await prisma.integration.deleteMany({ where: { id: { in: integrations } } });
  await prisma.trackedEvent.deleteMany({ where: { eventId: { endsWith: String(runId) } } });
  if (tenants.length) {
    await prisma.aPIKey.deleteMany({ where: { tenantId: { in: tenants } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  }
  await app.close();
  await prisma.$disconnect();
}
