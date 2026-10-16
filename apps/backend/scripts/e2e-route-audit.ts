// Route audit: every API route, probed with no credentials, with valid
// credentials but unknown ids, and with empty / malformed / oversized bodies.
// Fails on any 5xx, and on any non-public route that answers without auth.
// New routes are covered automatically.
// Run: pnpm --filter @shapi/backend e2e:route-audit
const { default: Fastify } = await import('fastify');
const { registerPlugins } = await import('../src/plugins/index.js');
const { registerRoutes } = await import('../src/routes/index.js');
const { prisma } = await import('../src/utils/prisma.js');
const { isPublicPath } = await import('../src/utils/api-keys.js');

type Route = { method: string; url: string };
const routes: Route[] = [];
const app = Fastify({ logger: false });
app.addHook('onRoute', options => {
  const methods = Array.isArray(options.method) ? options.method : [options.method];
  for (const method of methods) if (method !== 'HEAD') routes.push({ method, url: options.url });
});
await registerPlugins(app);
await registerRoutes(app);
// Test-only routes that fail on purpose, to check what an error response reveals.
app.get('/__audit/crash', async () => { throw new Error('Invalid `prisma.x.findMany()` invocation in C:\\secret\\path.ts'); });
app.get('/__audit/missing', async () => { throw Object.assign(new Error('Record to update not found.'), { code: 'P2025' }); });
await app.ready();

const auth = { 'x-api-key': process.env.SHAPI_API_KEY || 'shapi_demo_local_d3v_k3y_9f2c' };
const FAKE_ID = '00000000-0000-4000-8000-000000000000';
const fill = (url: string) => url.replace(/:([A-Za-z]+)/g, (_, name: string) => (name === 'token' ? 'x'.repeat(43) : FAKE_ID));
const failures: string[] = [];
const seen = new Set<string>();
let probes = 0;

async function probe(label: string, method: string, url: string, headers: Record<string, string>, payload?: unknown, expectAuth = false) {
  probes++;
  const response = await app.inject({ method: method as 'GET', url, headers: { ...headers, ...(payload === undefined ? {} : { 'content-type': 'application/json' }) }, ...(payload === undefined ? {} : { payload: typeof payload === 'string' ? payload : JSON.stringify(payload) }) });
  if (response.statusCode >= 500) failures.push(`${label} ${method} ${url} -> ${response.statusCode} ${response.body.slice(0, 160)}`);
  if (expectAuth && response.statusCode !== 401 && response.statusCode !== 403) {
    failures.push(`${label} ${method} ${url} -> ${response.statusCode} without credentials (expected 401)`);
  }
}

const apiRoutes = routes.filter(route => route.url.startsWith('/api/v1/'));
for (const route of apiRoutes) {
  const key = `${route.method} ${route.url}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const url = fill(route.url);
  const isPublic = isPublicPath(url);
  const isBody = ['POST', 'PUT', 'PATCH'].includes(route.method);
  // 1. No credentials: protected routes must refuse; public ones must not crash.
  await probe('no-auth', route.method, url, {}, isBody ? {} : undefined, !isPublic);
  // Webhook receivers (signature-checked) and auth flows are probed for crashes only.
  if (isPublic) {
    if (isBody) {
      await probe('public-garbage', route.method, url, {}, '{not json');
      await probe('public-wrong-types', route.method, url, {}, { email: 42, token: [], password: {} });
    }
    continue;
  }
  // 2. Valid credentials, unknown ids / empty or bad input: never a 5xx.
  await probe('auth', route.method, url, auth, isBody ? {} : undefined);
  if (isBody) {
    await probe('auth-garbage', route.method, url, auth, '{not json');
    await probe('auth-wrong-types', route.method, url, auth, { name: 42, email: [], role: 'GOD', sql: { a: 1 }, enabled: 'yes', databaseUrl: 7 });
    await probe('auth-oversized', route.method, url, auth, { name: 'x'.repeat(50_000), note: 'y'.repeat(50_000) });
  }
  // 3. Query-string abuse on list endpoints.
  if (route.method === 'GET' && !route.url.includes(':')) {
    await probe('auth-query', route.method, `${url}?page=-1&pageSize=99999&limit=abc&days=-5&status=NOPE`, auth);
  }
}

// Errors never leak internals; a missing record is a 404, not a crash.
const crash = await app.inject({ method: 'GET', url: '/__audit/crash' });
if (crash.statusCode !== 500 || /prisma|secret|path\.ts|stack/i.test(crash.body) || !JSON.parse(crash.body).requestId) {
  failures.push(`error handler leaks details or lacks a request id: ${crash.statusCode} ${crash.body}`);
}
const missing = await app.inject({ method: 'GET', url: '/__audit/missing' });
if (missing.statusCode !== 404) failures.push(`missing record answered ${missing.statusCode}, expected 404`);
const badJson = await app.inject({ method: 'POST', url: '/api/v1/integrations', headers: { ...auth, 'content-type': 'application/json' }, payload: '{oops' });
if (badJson.statusCode !== 400) failures.push(`malformed JSON answered ${badJson.statusCode}, expected 400`);

console.log(`Routes under /api/v1: ${seen.size}; probes: ${probes}`);
await app.close();
await prisma.$disconnect();
if (failures.length) {
  console.log(`\n${failures.length} problem(s):`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log('\nE2E ROUTE AUDIT OK');
}
