// End-to-end: "Forgot password" with a real database. Resend is intercepted,
// so nothing leaves the machine. Checks: no account enumeration, one-time and
// expiring links, a newer link replaces an older one, the new password works
// and the old one does not, every old session is signed out, and the operator
// script's link works.
// Run: pnpm --filter @shapi/backend e2e:password-reset
process.env.SHAPI_SIGNUP_MODE = 'invite';
process.env.SHAPI_SIGNUP_INVITE_CODE = 'e2e-invite-code-123';
process.env.RESEND_API_KEY = 're_e2e_not_real';
process.env.ALERT_EMAIL_FROM = 'SHAPI <no-reply@example.com>';

type Email = { to: string[]; subject: string; text: string; html: string };
const sent: Email[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('https://api.resend.com/')) {
    sent.push(JSON.parse(String(init?.body ?? '{}')));
    return new Response('{"id":"e2e"}', { status: 200 });
  }
  return realFetch(input, init);
}) as typeof fetch;

const { execSync } = await import('node:child_process');
const path = await import('node:path');
const { fileURLToPath } = await import('node:url');
const { default: Fastify } = await import('fastify');
const { registerPlugins } = await import('../src/plugins/index.js');
const { registerRoutes } = await import('../src/routes/index.js');
const { prisma } = await import('../src/utils/prisma.js');
const { createResetLink, RESET_TTL_MS } = await import('../src/services/password-reset.js');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ok - ${message}`);
}

const app = Fastify();
await registerPlugins(app);
await registerRoutes(app);
await app.ready();
const runId = Date.now();
const email = `reset-${runId}@example.com`;
const json = (r: { body: string }) => JSON.parse(r.body);
const post = (url: string, payload: unknown, cookie?: string) =>
  app.inject({ method: 'POST', url: `/api/v1${url}`, payload: payload as Record<string, unknown>, headers: cookie ? { cookie } : {} });
const cookieOf = (response: { headers: Record<string, unknown> }) => String(response.headers['set-cookie'] ?? '').split(';')[0];
const tokenOf = (link: string) => /token=([A-Za-z0-9_-]+)/.exec(link)?.[1] ?? '';
const emailsTo = (address: string) => sent.filter(message => message.to.includes(address));
async function waitForEmails(address: string, count: number) {
  for (let i = 0; i < 100 && emailsTo(address).length < count; i++) await new Promise(resolve => setTimeout(resolve, 30));
  return emailsTo(address);
}
let tenantId: string | undefined;

try {
  console.log('1. setup');
  const signup = await post('/auth/signup', { workspaceName: `Reset ${runId}`, name: 'Ada', email, password: 'first-password-123', inviteCode: 'e2e-invite-code-123' });
  assert(signup.statusCode === 201, 'account created');
  tenantId = json(signup).workspace.id;
  const oldSession = cookieOf(signup);
  const config = json(await app.inject({ method: 'GET', url: '/api/v1/auth/config' }));
  assert(config.passwordReset === true, '/auth/config says email reset is available');

  console.log('2. no account enumeration');
  const unknown = await post('/auth/password/forgot', { email: `nobody-${runId}@example.com` });
  const known = await post('/auth/password/forgot', { email: email.toUpperCase() });
  assert(unknown.statusCode === 202 && known.statusCode === 202 && unknown.body === known.body, 'same answer for a known and an unknown email');
  const first = (await waitForEmails(email, 1))[0];
  await new Promise(resolve => setTimeout(resolve, 200));
  assert(emailsTo(`nobody-${runId}@example.com`).length === 0, 'no email for an unknown address');
  assert(first?.subject === 'Reset your SHAPI password' && first.html.includes('Choose a new password'), 'reset email sent');
  const firstToken = tokenOf(first.text);
  assert(firstToken.length >= 40 && !first.text.includes('first-password'), 'email carries a long random token');
  assert((await prisma.passwordResetToken.count({ where: { tokenHash: firstToken } })) === 0, 'only a hash of the token is stored');

  console.log('3. a newer link replaces the older one');
  await post('/auth/password/forgot', { email });
  const second = (await waitForEmails(email, 2))[1];
  const secondToken = tokenOf(second.text);
  assert(secondToken && secondToken !== firstToken, 'second link issued');
  const stale = await post('/auth/password/reset', { token: firstToken, password: 'new-password-456' });
  assert(stale.statusCode === 400 && /invalid or has expired/.test(json(stale).error), 'older link no longer works');

  console.log('4. reset');
  const short = await post('/auth/password/reset', { token: secondToken, password: 'short' });
  assert(short.statusCode === 400 && /at least 10/.test(json(short).error), 'short password refused (link still usable)');
  const reset = await post('/auth/password/reset', { token: secondToken, password: 'new-password-456' });
  assert(reset.statusCode === 200 && cookieOf(reset).startsWith('shapi_session='), 'password changed and signed in');
  const again = await post('/auth/password/reset', { token: secondToken, password: 'another-password-789' });
  assert(again.statusCode === 400, 'link works only once');
  const meOld = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: oldSession } });
  assert(meOld.statusCode === 401, 'the session from before the reset is signed out');
  const meNew = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: cookieOf(reset) } });
  assert(meNew.statusCode === 200, 'the new session works');
  assert((await post('/auth/password/login', { email, password: 'first-password-123' })).statusCode === 401, 'old password refused');
  assert((await post('/auth/password/login', { email, password: 'new-password-456' })).statusCode === 200, 'new password works');

  console.log('5. expiry and the operator link');
  const user = await prisma.user.findFirstOrThrow({ where: { tenantId } });
  const expired = await createResetLink(user.id, new Date(Date.now() - RESET_TTL_MS - 60_000));
  assert((await post('/auth/password/reset', { token: tokenOf(expired), password: 'expired-password-1' })).statusCode === 400, 'an expired link is refused');
  const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const output = execSync(`npx tsx scripts/password-reset-link.ts ${email}`, { cwd: backendDir, encoding: 'utf8' });
  const operatorToken = tokenOf(output);
  assert(operatorToken && output.includes('/#/reset-password?token='), 'operator script prints a reset link');
  assert((await post('/auth/password/reset', { token: operatorToken, password: 'operator-password-1' })).statusCode === 200, 'operator link resets the password');
  assert((await post('/auth/password/forgot', { email: 'not-an-email' })).statusCode === 400, 'invalid email refused');
  console.log('\nE2E PASSWORD RESET OK');
} finally {
  if (tenantId) await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await app.close();
  await prisma.$disconnect();
}
