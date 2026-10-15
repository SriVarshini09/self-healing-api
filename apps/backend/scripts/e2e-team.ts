// End-to-end: inviting teammates, with a real database. Resend is intercepted,
// so nothing leaves the machine. Checks: invite links (emailed and returned
// once), accepting, roles really limit what people can do, re-invite and
// revoke kill old links, expiry, removal signs the person out, Owner and self
// protections, and workspace isolation.
// Run: pnpm --filter @shapi/backend e2e:team
process.env.SHAPI_SIGNUP_MODE = 'invite';
process.env.SHAPI_SIGNUP_INVITE_CODE = 'e2e-invite-code-123';
process.env.RESEND_API_KEY = 're_e2e_not_real';
process.env.ALERT_EMAIL_FROM = 'SHAPI <no-reply@example.com>';

type Email = { to: string[]; subject: string; text: string };
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

const { default: Fastify } = await import('fastify');
const { registerPlugins } = await import('../src/plugins/index.js');
const { registerRoutes } = await import('../src/routes/index.js');
const { prisma } = await import('../src/utils/prisma.js');
const { createInvite, INVITE_TTL_MS } = await import('../src/services/team.js');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ok - ${message}`);
}

const app = Fastify();
await registerPlugins(app);
await registerRoutes(app);
await app.ready();
const runId = Date.now();
const mail = (who: string) => `${who}-${runId}@example.com`;
const json = (r: { body: string }) => JSON.parse(r.body);
const cookieOf = (response: { headers: Record<string, unknown> }) => String(response.headers['set-cookie'] ?? '').split(';')[0];
const tokenOf = (link: string) => /token=([A-Za-z0-9_-]+)/.exec(link)?.[1] ?? '';
const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie?: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: cookie ? { cookie } : {}, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
const tenants: string[] = [];

async function signup(who: string) {
  const response = await call('POST', '/auth/signup', undefined, { workspaceName: `Team ${who} ${runId}`, name: who, email: mail(who), password: 'owner-password-123', inviteCode: 'e2e-invite-code-123' });
  if (response.statusCode !== 201) throw new Error(`signup failed: ${response.body}`);
  tenants.push(json(response).workspace.id);
  return { cookie: cookieOf(response), tenantId: json(response).workspace.id as string };
}
async function accept(link: string, name: string) {
  return call('POST', '/auth/invites/accept', undefined, { token: tokenOf(link), name, password: `${name}-password-123` });
}

try {
  console.log('1. invite');
  const owner = await signup('owner');
  const members0 = json(await call('GET', '/workspace/members', owner.cookie));
  assert(members0.members.length === 1 && members0.members[0].you && members0.members[0].role === 'OWNER' && members0.canManage, 'owner sees only themself and can manage');
  const inviteOp = await call('POST', '/workspace/invites', owner.cookie, { email: mail('operator').toUpperCase(), role: 'OPERATOR' });
  assert(inviteOp.statusCode === 201 && json(inviteOp).emailed === true && json(inviteOp).invite.email === mail('operator'), 'operator invited (email normalized, emailed)');
  const opLink = json(inviteOp).link as string;
  assert(opLink.includes('/#/accept-invite?token=') && tokenOf(opLink).length >= 40, 'one-time link returned');
  const email = sent.find(message => message.to.includes(mail('operator')));
  assert(email?.subject.startsWith('Join Team owner') && email.text.includes(opLink) && email.text.includes('owner invited you'), 'invite email names the workspace and inviter');
  assert((await prisma.workspaceInvite.count({ where: { tokenHash: tokenOf(opLink) } })) === 0, 'only a hash of the token is stored');
  const viewerLink = json(await call('POST', '/workspace/invites', owner.cookie, { email: mail('viewer'), role: 'VIEWER' })).link as string;
  assert(json(await call('GET', '/workspace/members', owner.cookie)).invites.length === 2, 'two pending invites listed');
  assert((await call('POST', '/workspace/invites', owner.cookie, { email: mail('owner') })).statusCode === 409, 'cannot invite someone already in the workspace');
  assert((await call('POST', '/workspace/invites', owner.cookie, { email: mail('x'), role: 'OWNER' })).statusCode === 400, 'cannot invite a second Owner');

  console.log('2. accept');
  const preview = await call('GET', `/auth/invites/${tokenOf(opLink)}`);
  assert(preview.statusCode === 200 && json(preview).workspace === `Team owner ${runId}` && json(preview).role === 'OPERATOR', 'link preview shows workspace and role without signing in');
  assert((await call('POST', '/auth/invites/accept', undefined, { token: tokenOf(opLink), name: 'Op', password: 'short' })).statusCode === 400, 'short password refused');
  const opAccept = await accept(opLink, 'operator');
  assert(opAccept.statusCode === 201 && json(opAccept).user.role === 'OPERATOR', 'operator joined');
  const opCookie = cookieOf(opAccept);
  const me = json(await call('GET', '/auth/me', opCookie));
  assert(me.user.tenantId === owner.tenantId, 'operator is in the owner\'s workspace');
  assert((await accept(opLink, 'again')).statusCode === 400, 'link works only once');
  assert((await call('GET', `/auth/invites/${tokenOf(opLink)}`)).statusCode === 404, 'used link no longer previews');

  console.log('3. roles limit what people can do');
  assert((await call('POST', '/workspace/invites', opCookie, { email: mail('y') })).statusCode === 403, 'operator cannot invite');
  assert((await call('GET', '/workspace/members', opCookie)).statusCode === 200 && json(await call('GET', '/workspace/members', opCookie)).canManage === false, 'operator can see the team, not manage it');
  const viewerCookie = cookieOf(await accept(viewerLink, 'viewer'));
  assert((await call('GET', '/incidents', viewerCookie)).statusCode === 200, 'viewer can read incidents');
  assert((await call('POST', '/integrations', viewerCookie, { name: 'x', type: 'STRIPE', config: {} })).statusCode === 403, 'viewer cannot change anything');

  console.log('4. re-invite, revoke, expiry');
  const first = json(await call('POST', '/workspace/invites', owner.cookie, { email: mail('late') })).link as string;
  const second = json(await call('POST', '/workspace/invites', owner.cookie, { email: mail('late') })).link as string;
  assert((await call('GET', `/auth/invites/${tokenOf(first)}`)).statusCode === 404 && (await call('GET', `/auth/invites/${tokenOf(second)}`)).statusCode === 200, 're-invite replaces the earlier link');
  const pending = json(await call('GET', '/workspace/members', owner.cookie)).invites.find((invite: { email: string }) => invite.email === mail('late'));
  assert((await call('DELETE', `/workspace/invites/${pending.id}`, owner.cookie)).statusCode === 204 && (await call('GET', `/auth/invites/${tokenOf(second)}`)).statusCode === 404, 'revoked link stops working');
  const expired = await createInvite(owner.tenantId, mail('expired'), 'VIEWER', null, new Date(Date.now() - INVITE_TTL_MS - 60_000));
  assert((await call('GET', `/auth/invites/${tokenOf(expired.link)}`)).statusCode === 404, 'expired link refused');

  console.log('5. roles, removal and protections');
  const list = json(await call('GET', '/workspace/members', owner.cookie)).members as Array<{ id: string; email: string; role: string }>;
  const op = list.find(member => member.email === mail('operator'))!;
  const ownerRow = list.find(member => member.role === 'OWNER')!;
  assert((await call('PATCH', `/workspace/members/${op.id}`, owner.cookie, { role: 'ADMIN' })).statusCode === 200, 'owner promotes operator to admin');
  assert((await call('POST', '/workspace/invites', opCookie, { email: mail('by-admin') })).statusCode === 201, 'the promotion applies immediately (admin can invite)');
  assert((await call('PATCH', `/workspace/members/${ownerRow.id}`, opCookie, { role: 'VIEWER' })).statusCode === 400, "admin cannot change the Owner's role");
  assert((await call('DELETE', `/workspace/members/${ownerRow.id}`, opCookie)).statusCode === 400, 'admin cannot remove the Owner');
  assert((await call('DELETE', `/workspace/members/${ownerRow.id}`, owner.cookie)).statusCode === 400, 'nobody can remove themselves');
  assert((await call('DELETE', `/workspace/members/${op.id}`, owner.cookie)).statusCode === 204, 'owner removes the admin');
  assert((await call('GET', '/auth/me', opCookie)).statusCode === 401, 'removed person is signed out');

  console.log('6. isolation');
  const other = await signup('other');
  assert((await call('POST', '/workspace/invites', owner.cookie, { email: mail('other') })).statusCode === 409, 'cannot invite someone who has a workspace elsewhere');
  const otherMembers = json(await call('GET', '/workspace/members', other.cookie));
  assert(otherMembers.members.length === 1 && otherMembers.invites.length === 0, 'another workspace sees none of these people or invites');
  assert((await call('DELETE', `/workspace/members/${list.find(member => member.email === mail('viewer'))!.id}`, other.cookie)).statusCode === 404, "cannot remove another workspace's member");
  console.log('\nE2E TEAM OK');
} finally {
  if (tenants.length) await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  await app.close();
  await prisma.$disconnect();
}
