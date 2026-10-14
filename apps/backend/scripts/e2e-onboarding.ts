// End-to-end: self-serve onboarding with an invite code.
// sign up -> session -> workspace -> Stripe connection -> API key -> sign in again,
// plus the refusals (bad invite, short password, duplicate email, wrong password)
// and tenant isolation from the seeded demo workspace.
// Run: pnpm --filter @shapi/backend e2e:onboarding
process.env.SHAPI_SIGNUP_MODE = 'invite';
process.env.SHAPI_SIGNUP_INVITE_CODE = 'e2e-invite-code-123';

const { default: Fastify } = await import('fastify');
const { registerPlugins } = await import('../src/plugins/index.js');
const { registerRoutes } = await import('../src/routes/index.js');
const { prisma } = await import('../src/utils/prisma.js');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ok - ${message}`);
}

const app = Fastify();
await registerPlugins(app);
await registerRoutes(app);
await app.ready();

const json = (r: { body: string }) => JSON.parse(r.body);
const cookieFrom = (r: { headers: Record<string, unknown> }) => {
  const header = r.headers['set-cookie'];
  const value = Array.isArray(header) ? header.find(c => String(c).startsWith('shapi_session=')) : header;
  return String(value ?? '').split(';')[0];
};

const email = `founder-${Date.now()}@example.com`;
const password = 'a-long-test-password';
let tenantId: string | undefined;

try {
  console.log('1. sign-up rules');
  const config = json(await app.inject({ method: 'GET', url: '/api/v1/auth/config' }));
  assert(config.signup === 'invite' && config.passwordLogin === true, 'config advertises invite-only sign-up and password login');
  const base = { workspaceName: 'Acme Billing', name: 'Ada Founder', email, password, inviteCode: 'e2e-invite-code-123' };
  assert((await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { ...base, inviteCode: 'wrong-code-000' } })).statusCode === 403, 'wrong invite code is refused');
  const short = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { ...base, password: 'short' } });
  assert(short.statusCode === 400 && /10 characters/.test(json(short).error), 'short password is refused with a clear message');

  console.log('2. create workspace');
  const signup = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: base });
  assert(signup.statusCode === 201, `sign-up creates the workspace (${signup.statusCode})`);
  tenantId = json(signup).workspace.id;
  const session = cookieFrom(signup);
  assert(session.startsWith('shapi_session='), 'sign-up starts a session (httpOnly cookie)');
  const me = json(await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: session } }));
  assert(me.user.role === 'OWNER' && me.user.tenantId === tenantId, 'the new user owns the new workspace');
  const workspace = json(await app.inject({ method: 'GET', url: '/api/v1/workspace', headers: { cookie: session } }));
  assert(workspace.name === 'Acme Billing', 'workspace endpoint returns its name');
  assert((await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: base })).statusCode === 409, 'the same email cannot sign up twice');

  console.log('3. isolation');
  const integrations = json(await app.inject({ method: 'GET', url: '/api/v1/integrations?pageSize=100', headers: { cookie: session } }));
  assert(integrations.data.length === 0, 'a new workspace sees none of the demo workspace data');

  console.log('4. connect Stripe');
  const created = await app.inject({ method: 'POST', url: '/api/v1/integrations', headers: { cookie: session }, payload: { name: 'Stripe', type: 'STRIPE' } });
  assert(created.statusCode === 201, 'Stripe connection created');
  const integrationId = json(created).id;
  const patched = await app.inject({ method: 'PATCH', url: `/api/v1/integrations/${integrationId}`, headers: { cookie: session }, payload: { webhookSecret: 'whsec_e2e_from_stripe' } });
  assert(json(patched).webhookSecretConfigured === true && !patched.body.includes('whsec_e2e_from_stripe'), 'Stripe signing secret saved and never echoed');

  console.log('5. API key for automation');
  const key = await app.inject({ method: 'POST', url: '/api/v1/api-keys', headers: { cookie: session }, payload: { name: 'CI', permissions: ['read', 'write'] } });
  assert(key.statusCode === 201 && json(key).key, 'owner can create an API key (shown once)');
  const viaKey = json(await app.inject({ method: 'GET', url: '/api/v1/workspace', headers: { 'x-api-key': json(key).key } }));
  assert(viaKey.id === tenantId, 'the API key is scoped to the new workspace');

  console.log('6. sign in again');
  assert((await app.inject({ method: 'POST', url: '/api/v1/auth/password/login', payload: { email, password: 'wrong-password-123' } })).statusCode === 401, 'wrong password is refused');
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/password/login', payload: { email: email.toUpperCase(), password } });
  assert(login.statusCode === 200 && cookieFrom(login).startsWith('shapi_session='), 'sign-in works (email is case-insensitive)');

  console.log('\nE2E ONBOARDING OK');
} finally {
  if (tenantId) {
    await prisma.aPIKey.deleteMany({ where: { tenantId } });
    await prisma.integration.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
  }
  await app.close();
  await prisma.$disconnect();
}
