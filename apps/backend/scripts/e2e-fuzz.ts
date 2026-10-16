// Seeded fuzzing of every API route. For each route and each round, sends random hostile
// input (bodies, query strings, path parameters, headers) as an owner, as a read-only viewer
// and with no credentials. Fails on any 5xx, on any response that leaks internals (stack
// traces, file paths, database errors), on a protected route answering without credentials,
// on a viewer changing anything, or if the process crashes.
// Reproduce a failure with the printed seed:  FUZZ_SEED=<n> FUZZ_ROUNDS=1 pnpm e2e:fuzz
// Run: pnpm --filter @shapi/backend e2e:fuzz            (FUZZ_ROUNDS defaults to 15)
const ROUNDS = Number(process.env.FUZZ_ROUNDS ?? 15);
const BASE_SEED = Number(process.env.FUZZ_SEED ?? 20261016);

const crashes: string[] = [];
// A crash in the real server ends the process; here it is reported with the request that caused it.
let currentRequest = '(none)';
process.on('uncaughtException', error => {
  crashes.push(`uncaughtException during [${currentRequest}]: ${error.stack ?? error.message}`);
  console.log(`
PROCESS CRASH SIGNAL during [${currentRequest}]:
${error.stack ?? error.message}`);
});
process.on('unhandledRejection', reason => {
  crashes.push(`unhandledRejection during [${currentRequest}]: ${String(reason)}`);
  console.log(`
UNHANDLED REJECTION during [${currentRequest}]: ${reason instanceof Error ? reason.stack : String(reason)}`);
});

const { default: Fastify } = await import('fastify');
const { registerPlugins } = await import('../src/plugins/index.js');
const { registerRoutes } = await import('../src/routes/index.js');
const { prisma } = await import('../src/utils/prisma.js');
const { generateApiKey, isPublicPath } = await import('../src/utils/api-keys.js');

// ---- seeded random ----
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NASTY_STRINGS = [
  '', ' ', 'a', 'null', 'undefined', 'true', '0', '-1', '1e309', 'NaN', '{}', '[]', '{"a":1}',
  "' OR '1'='1", "'; DROP TABLE \"User\"; --", '$1', ':customer', '${7*7}', '{{7*7}}', '<script>alert(1)</script>',
  '<!channel>', '../../etc/passwd', '..\\..\\windows\\win.ini', '%00', '\u0000', '\u202e', '😀'.repeat(50), 'é'.normalize('NFD'),
  'x'.repeat(300), 'x'.repeat(5000), 'x'.repeat(70_000), '\n\r\n', 'a\u0000b', '__proto__', 'constructor', 'prototype',
  'whsec_', 'shapi_', 'rk_live_x', 'sk_live_abc', 'postgres://u:p@invalid.invalid:5432/d', 'https://invalid.invalid/x',
  'http://169.254.169.254/latest', '2026-13-45T99:99:99Z', '00000000-0000-4000-8000-000000000000', 'ADMIN', 'OWNER', 'DETECTED',
];
const KEYS = [
  'name', 'email', 'password', 'role', 'type', 'status', 'sql', 'databaseUrl', 'stripeApiKey', 'paramBindings', 'triggerEventType',
  'deadlineSec', 'integrationId', 'webhookEventId', 'fixCandidate', 'permissions', 'expiresAt', 'enabled', 'config', 'webhookSecret',
  'kind', 'emails', 'slackWebhookUrl', 'confirm', 'workspaceName', 'inviteCode', 'token', 'candidateId', 'installationId', 'repository',
  'title', 'body', 'previewToken', 'payload', 'eventId', 'integration', 'timestamp', 'page', 'pageSize', 'description', 'severity',
  'rootCause', 'suggestedFix', 'githubPrUrl', 'notifyResolved', 'githubInstallationId', 'branchName', 'base', 'company', 'note', 'website',
  '__proto__', 'constructor',
];

/** Own property even for keys like __proto__, exactly as a hostile JSON body delivers them. */
function define(target: Record<string, unknown>, key: string, value: unknown) {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}
/** Slicing can split an emoji in half; make it well-formed before encoding. */
const enc = (value: string) => encodeURIComponent(value.toWellFormed());
const asText = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value) ?? 'undefined');

function randomValue(r: () => number, depth = 0): unknown {
  const roll = r();
  if (roll < 0.35) return NASTY_STRINGS[Math.floor(r() * NASTY_STRINGS.length)];
  if (roll < 0.45) return Math.floor((r() - 0.5) * 2 ** (r() * 40));
  if (roll < 0.5) return [0, -1, 1.5, 2 ** 53, -(2 ** 53), 1e21][Math.floor(r() * 6)];
  if (roll < 0.58) return r() < 0.5;
  if (roll < 0.64) return null;
  if (roll < 0.74 && depth < 3) return Array.from({ length: Math.floor(r() * 5) }, () => randomValue(r, depth + 1));
  if (depth < 3) {
    const out: Record<string, unknown> = {};
    for (let i = 0, n = Math.floor(r() * 5); i < n; i++) define(out, KEYS[Math.floor(r() * KEYS.length)], randomValue(r, depth + 1));
    return out;
  }
  return NASTY_STRINGS[Math.floor(r() * NASTY_STRINGS.length)];
}

function randomBody(r: () => number): { payload: string; contentType: string } {
  const roll = r();
  if (roll < 0.08) return { payload: '{not json', contentType: 'application/json' };
  if (roll < 0.12) return { payload: '', contentType: 'application/json' };
  if (roll < 0.15) return { payload: 'a=1&b[]=2', contentType: 'application/x-www-form-urlencoded' };
  if (roll < 0.18) return { payload: 'plain text', contentType: 'text/plain' };
  const body: Record<string, unknown> = {};
  for (let i = 0, n = 1 + Math.floor(r() * 7); i < n; i++) define(body, KEYS[Math.floor(r() * KEYS.length)], randomValue(r));
  if (r() < 0.1) return { payload: JSON.stringify(randomValue(r)), contentType: 'application/json' };
  return { payload: JSON.stringify(body), contentType: 'application/json' };
}

// ---- app and fixtures ----
type Route = { method: string; url: string };
const routes: Route[] = [];
const app = Fastify({ logger: false });
app.addHook('onRoute', options => {
  for (const method of Array.isArray(options.method) ? options.method : [options.method]) if (method !== 'HEAD') routes.push({ method, url: options.url });
});
await registerPlugins(app);
await registerRoutes(app);
await app.ready();

const runId = Date.now();
const tenant = await prisma.tenant.create({ data: { name: `fuzz ${runId}`, slug: `fuzz-${runId}` } });
const owner = generateApiKey();
const viewer = generateApiKey();
await prisma.aPIKey.create({ data: { tenantId: tenant.id, name: 'fuzz owner', keyHash: owner.keyHash, prefix: owner.prefix, permissions: ['*'], role: 'OWNER' } });
await prisma.aPIKey.create({ data: { tenantId: tenant.id, name: 'fuzz viewer', keyHash: viewer.keyHash, prefix: viewer.prefix, permissions: ['read'], role: 'VIEWER' } });

const integration = await prisma.integration.create({ data: { tenantId: tenant.id, name: 'Fuzz Stripe', type: 'STRIPE', config: {}, webhookSecret: `whsec_fuzz_${runId}_abcdefghijklmnop` } });
await prisma.driftDetectionConfig.create({ data: { integrationId: integration.id } });
const invariant = await prisma.invariant.create({ data: { integrationId: integration.id, name: 'Fuzz rule', description: 'x', predicateExpression: "event.type === 'x'", predicateDescription: 'x' } });
const event = await prisma.webhookEvent.create({ data: { integrationId: integration.id, eventType: 'invoice.paid', providerEventId: `evt_fuzz_${runId}`, payload: {}, headers: {} } });
const incident = await prisma.incident.create({ data: { integrationId: integration.id, invariantId: invariant.id, title: 'Fuzz incident', description: 'x', severity: 'LOW' } });
const destination = await prisma.alertDestination.create({ data: { tenantId: tenant.id, kind: 'EMAIL', name: 'fuzz', emails: ['a@example.com'] } });
const REAL_IDS = [integration.id, invariant.id, event.id, incident.id, destination.id];
const FAKE_ID = '00000000-0000-4000-8000-000000000000';

const failures: string[] = [];
const timings = new Map<string, number>();
let probes = 0;
const LEAK = /(\bat\s+[\w$.<>]+\s+\(|node_modules|\.ts:\d+|\.js:\d+|PrismaClient|prisma\.\w+\.\w+\(|Invalid `prisma|C:\\\\|\/home\/|\/app\/|ECONNREFUSED|password authentication|SQLSTATE|relation ".*" does not exist)/;

function pathFor(url: string, r: () => number): string {
  return url.replace(/:([A-Za-z]+)/g, () => {
    const roll = r();
    if (roll < 0.4) return REAL_IDS[Math.floor(r() * REAL_IDS.length)];
    if (roll < 0.55) return FAKE_ID;
    const raw = NASTY_STRINGS[Math.floor(r() * NASTY_STRINGS.length)].slice(0, 400);
    return enc(raw) || 'x';
  });
}

async function send(seed: number, who: 'owner' | 'viewer' | 'anon', route: Route, r: () => number) {
  probes++;
  const isBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method) && r() < 0.9;
  const headers: Record<string, string> = {};
  if (who === 'owner') headers['x-api-key'] = owner.key;
  if (who === 'viewer') headers['x-api-key'] = viewer.key;
  if (r() < 0.05) headers['x-forwarded-for'] = NASTY_STRINGS[Math.floor(r() * NASTY_STRINGS.length)].slice(0, 100).replace(/[^\x20-\x7e]/g, '');
  let payload: string | undefined;
  if (isBody) {
    const body = randomBody(r);
    payload = body.payload;
    headers['content-type'] = body.contentType;
  }
  const query = r() < 0.4 ? `?${Array.from({ length: 1 + Math.floor(r() * 4) }, () => `${enc(KEYS[Math.floor(r() * KEYS.length)])}=${enc(asText(randomValue(r)).slice(0, 200))}`).join('&')}` : '';
  const url = `${pathFor(route.url, r)}${query}`;
  const label = `seed=${seed} ${who} ${route.method} ${url.slice(0, 140)}`;
  currentRequest = `${label} body=${(payload ?? '').slice(0, 300)}`;
  let response;
  const startedAt = Date.now();
  try {
    response = await app.inject({ method: route.method as 'GET', url, headers, ...(payload === undefined ? {} : { payload }) });
    const took = Date.now() - startedAt;
    const key = `${route.method} ${route.url}`;
    timings.set(key, Math.max(timings.get(key) ?? 0, took));
  } catch (error) {
    failures.push(`${label} -> inject threw: ${(error as Error).message}`);
    return;
  }
  if (response.statusCode >= 500) failures.push(`${label} -> ${response.statusCode} ${response.body.slice(0, 140)}`);
  if (LEAK.test(response.body)) failures.push(`${label} -> response leaks internals: ${response.body.slice(0, 200)}`);
  if (!isPublicPath(url.split('?')[0]) && who === 'anon' && ![400, 401, 403, 404, 413, 414, 429].includes(response.statusCode)) {
    failures.push(`${label} -> ${response.statusCode} without credentials`);
  }
  if (who === 'viewer' && route.method !== 'GET' && !isPublicPath(url.split('?')[0]) && response.statusCode >= 200 && response.statusCode < 300) {
    failures.push(`${label} -> ${response.statusCode}: a read-only key changed something`);
  }
}

const apiRoutes = routes.filter(route => route.url.startsWith('/api/v1/'));
const unique = [...new Map(apiRoutes.map(route => [`${route.method} ${route.url}`, route])).values()]
  // Registering "forgot password"-style flows is covered elsewhere; here every route is fair game.
  .filter(route => route.url !== '/api/v1/bootstrap/tenant');
console.log(`Fuzzing ${unique.length} routes x ${ROUNDS} rounds (base seed ${BASE_SEED})`);

try {
  for (let round = 0; round < ROUNDS; round++) {
    const seed = BASE_SEED + round;
    const r = rng(seed);
    for (const route of unique) {
      for (const who of ['owner', 'viewer', 'anon'] as const) {
        const repeats = who === 'owner' ? 3 : 1;
        for (let i = 0; i < repeats; i++) await send(seed, who, route, r);
      }
    }
    if (crashes.length) break;
  }
} finally {
  await prisma.integration.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.trackedEvent.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.aPIKey.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.tenant.deleteMany({ where: { id: tenant.id } });
  await app.close();
  await prisma.$disconnect();
}

console.log(`probes: ${probes}`);
const slowest = [...timings.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5);
console.log(`slowest routes (ms): ${slowest.map(([route, ms]) => `${route}=${ms}`).join(' | ')}`);
for (const crash of crashes) failures.push(`PROCESS CRASH SIGNAL: ${crash}`);
if (failures.length) {
  const distinct = [...new Set(failures.map(failure => failure.replace(/seed=\d+ /, '').replace(/\/[0-9a-f-]{36}/g, '/<id>')))];
  console.log(`\n${failures.length} failure(s), ${distinct.length} distinct:`);
  for (const failure of failures.slice(0, 25)) console.log(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log('\nE2E FUZZ OK');
}
