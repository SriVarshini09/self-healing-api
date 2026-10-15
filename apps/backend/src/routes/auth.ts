import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { config } from '../config.js';
import {
  authenticateSession,
  createSession,
  destroySession,
  getCookie,
  oidcEnabled,
  SESSION_COOKIE,
} from '../utils/auth-sessions.js';
import { hashPassword, normalizeEmail, PASSWORD_ISSUER, verifyPassword } from '../utils/passwords.js';
import { emailAvailable } from '../services/email.js';
import { requestPasswordReset, resetPassword } from '../services/password-reset.js';
import { acceptInvite, findInvite, TeamError } from '../services/team.js';

type OidcMetadata = {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
};
type OidcProfile = { sub?: string; email?: string; name?: string; preferred_username?: string };
let metadataPromise: Promise<OidcMetadata> | undefined;

async function oidcFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.OIDC_PROVIDER_TIMEOUT_MS ?? 10_000);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function oidcMetadata(): Promise<OidcMetadata> {
  if (!config.OIDC_ISSUER_URL) throw new Error('OIDC is not configured');
  metadataPromise ??= oidcFetch(`${config.OIDC_ISSUER_URL.replace(/\/$/, '')}/.well-known/openid-configuration`)
    .then(async response => {
      if (!response.ok) throw new Error(`OIDC discovery failed with ${response.status}`);
      return response.json() as Promise<OidcMetadata>;
    })
    .catch(error => {
      metadataPromise = undefined;
      throw error;
    });
  return metadataPromise;
}

function sameSecret(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function stateCookie(state: string): string {
  const signature = crypto.createHmac('sha256', config.JWT_SECRET).update(state).digest('base64url');
  const secure = config.NODE_ENV === 'production' ? '; Secure' : '';
  return `shapi_oidc_state=${state}.${signature}; Path=/api/v1/auth; Max-Age=600; HttpOnly; SameSite=Lax${secure}`;
}

function clearStateCookie(): string {
  const secure = config.NODE_ENV === 'production' ? '; Secure' : '';
  return `shapi_oidc_state=; Path=/api/v1/auth; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}

/** Effective sign-up mode: 'invite' without a configured code is closed. */
export function signupMode(): 'closed' | 'invite' | 'open' {
  const mode = config.SHAPI_SIGNUP_MODE ?? 'invite';
  if (mode === 'invite' && !config.SHAPI_SIGNUP_INVITE_CODE) return 'closed';
  return mode;
}

const signupSchema = z.object({
  workspaceName: z.string().trim().min(2).max(80),
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(200),
  password: z.string().min(10).max(200),
  inviteCode: z.string().max(200).optional(),
}).strict();

const loginSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
}).strict();

const forgotSchema = z.object({ email: z.string().trim().email().max(200) }).strict();
const acceptSchema = z.object({
  token: z.string().min(20).max(200),
  name: z.string().trim().min(1).max(80),
  password: z.string().min(10).max(200),
}).strict();
const resetSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(10).max(200),
}).strict();

export function workspaceSlug(name: string): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'workspace';
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

// Brute-force protection for credential endpoints, keyed by client IP.
const credentialRateLimit = { rateLimit: { max: 10, timeWindow: '15 minutes' } };

export async function authRoutes(app: FastifyInstance) {
  app.get('/auth/config', async (_request, reply) => reply.send({
    oidcEnabled: oidcEnabled(),
    passwordLogin: true,
    signup: signupMode(),
    // Whether "Forgot password" can email a link (needs Resend).
    passwordReset: emailAvailable(),
  }));

  // Self-serve: create a workspace and its Owner account, then sign in.
  app.post('/auth/signup', { config: credentialRateLimit }, async (request, reply) => {
    const mode = signupMode();
    if (mode === 'closed') return reply.code(403).send({ error: 'Sign-up is closed on this SHAPI instance' });
    const parsed = signupSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors;
      const first = Object.entries(fields)[0];
      const message = first?.[0] === 'password'
        ? 'Password must be at least 10 characters'
        : first ? `Check the ${first[0]} field` : 'Invalid sign-up details';
      return reply.code(400).send({ error: message });
    }
    const body = parsed.data;
    if (mode === 'invite' && !sameSecret(body.inviteCode?.trim(), config.SHAPI_SIGNUP_INVITE_CODE)) {
      return reply.code(403).send({ error: 'That invite code is not valid' });
    }
    const email = normalizeEmail(body.email);
    const existing = await prisma.user.findUnique({ where: { issuer_subject: { issuer: PASSWORD_ISSUER, subject: email } } });
    if (existing) return reply.code(409).send({ error: 'An account with this email already exists. Sign in instead.' });

    const passwordHash = await hashPassword(body.password);
    const { tenant, user } = await prisma.$transaction(async tx => {
      const tenant = await tx.tenant.create({ data: { name: body.workspaceName, slug: workspaceSlug(body.workspaceName) } });
      const user = await tx.user.create({
        data: { tenantId: tenant.id, issuer: PASSWORD_ISSUER, subject: email, email, name: body.name, role: 'OWNER', passwordHash },
      });
      return { tenant, user };
    });
    await createSession(user.id, reply);
    return reply.code(201).send({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      workspace: { id: tenant.id, name: tenant.name },
    });
  });

  app.post('/auth/password/login', { config: credentialRateLimit }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Enter your email and password' });
    const email = normalizeEmail(parsed.data.email);
    const user = await prisma.user.findUnique({ where: { issuer_subject: { issuer: PASSWORD_ISSUER, subject: email } } });
    const ok = await verifyPassword(parsed.data.password, user?.passwordHash);
    if (!user || !ok) return reply.code(401).send({ error: 'Email or password is incorrect' });
    await createSession(user.id, reply);
    return reply.send({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  });

  // Always the same answer, sent before any lookup or email, so this endpoint
  // never reveals whether an account exists.
  app.post('/auth/password/forgot', { config: credentialRateLimit }, async (request, reply) => {
    const parsed = forgotSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Enter a valid email address' });
    void requestPasswordReset(parsed.data.email);
    return reply.code(202).send({ ok: true });
  });

  app.post('/auth/password/reset', { config: credentialRateLimit }, async (request, reply) => {
    const parsed = resetSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const passwordIssue = parsed.error.issues.some(issue => issue.path[0] === 'password');
      return reply.code(400).send({ error: passwordIssue ? 'Password must be at least 10 characters' : 'This reset link is not valid' });
    }
    const user = await resetPassword(parsed.data.token, parsed.data.password);
    if (!user) return reply.code(400).send({ error: 'This reset link is invalid or has expired. Ask for a new one.' });
    await createSession(user.id, reply);
    return reply.send({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  });

  // Invite links (public: the invited person has no account yet).
  app.get('/auth/invites/:token', { config: credentialRateLimit }, async (request, reply) => {
    const { token } = request.params as { token: string };
    const invite = token.length >= 20 && token.length <= 200 ? await findInvite(token) : null;
    if (!invite) return reply.code(404).send({ error: 'This invite link is invalid or has expired. Ask for a new one.' });
    return reply.send({ workspace: invite.tenant.name, email: invite.email, role: invite.role, invitedBy: invite.invitedBy?.name ?? null });
  });

  app.post('/auth/invites/accept', { config: credentialRateLimit }, async (request, reply) => {
    const parsed = acceptSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const passwordIssue = parsed.error.issues.some(issue => issue.path[0] === 'password');
      return reply.code(400).send({ error: passwordIssue ? 'Password must be at least 10 characters' : 'Enter your name' });
    }
    try {
      const user = await acceptInvite(parsed.data.token, parsed.data.name, parsed.data.password);
      await createSession(user.id, reply);
      return reply.code(201).send({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    } catch (error) {
      if (error instanceof TeamError) return reply.code(error.status).send({ error: error.message });
      throw error;
    }
  });

  app.get('/auth/login', async (_request, reply) => {
    if (!oidcEnabled()) return reply.code(404).send({ error: 'OIDC login is not configured' });
    const state = crypto.randomBytes(24).toString('base64url');
    let metadata: OidcMetadata;
    try {
      metadata = await oidcMetadata();
    } catch {
      return reply.code(502).send({ error: 'OIDC provider discovery unavailable' });
    }
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.OIDC_CLIENT_ID!,
      redirect_uri: config.OIDC_REDIRECT_URI!,
      scope: config.OIDC_SCOPES,
      state,
    });
    return reply.header('set-cookie', stateCookie(state)).redirect(`${metadata.authorization_endpoint}?${params}`);
  });

  app.get('/auth/callback', async (request, reply) => {
    if (!oidcEnabled()) return reply.code(404).send({ error: 'OIDC login is not configured' });
    const query = (request.query ?? {}) as { code?: string; state?: string; error?: string };
    const stateValue = getCookie(request.headers.cookie, 'shapi_oidc_state');
    const [state, signature] = stateValue?.split('.') ?? [];
    const expected = crypto.createHmac('sha256', config.JWT_SECRET).update(state ?? '').digest('base64url');
    if (!query.code || !query.state || !sameSecret(query.state, state) || !sameSecret(signature, expected)) {
      return reply.header('set-cookie', clearStateCookie()).code(400).send({ error: query.error ?? 'Invalid OIDC callback state' });
    }

    let metadata: OidcMetadata;
    try {
      metadata = await oidcMetadata();
    } catch {
      return reply.code(502).send({ error: 'OIDC provider discovery unavailable' });
    }

    let tokenResponse: Response;
    try {
      tokenResponse = await oidcFetch(metadata.token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: query.code,
          client_id: config.OIDC_CLIENT_ID!,
          client_secret: config.OIDC_CLIENT_SECRET!,
          redirect_uri: config.OIDC_REDIRECT_URI!,
        }),
      });
    } catch {
      return reply.code(502).send({ error: 'OIDC token exchange unavailable' });
    }
    if (!tokenResponse.ok) return reply.code(502).send({ error: 'OIDC token exchange failed' });
    let tokens: { access_token?: string };
    try {
      tokens = await tokenResponse.json() as { access_token?: string };
    } catch {
      return reply.code(502).send({ error: 'OIDC token exchange returned invalid data' });
    }
    if (!tokens.access_token || !metadata.userinfo_endpoint) return reply.code(502).send({ error: 'OIDC provider did not return a usable user profile endpoint' });
    let profileResponse: Response;
    try {
      profileResponse = await oidcFetch(metadata.userinfo_endpoint, { headers: { authorization: `Bearer ${tokens.access_token}` } });
    } catch {
      return reply.code(502).send({ error: 'OIDC user profile lookup unavailable' });
    }
    if (!profileResponse.ok) return reply.code(502).send({ error: 'OIDC user profile lookup failed' });
    let profile: OidcProfile;
    try {
      profile = await profileResponse.json() as OidcProfile;
    } catch {
      return reply.code(502).send({ error: 'OIDC user profile returned invalid data' });
    }
    if (!profile.sub || !profile.email || !config.OIDC_DEFAULT_TENANT_SLUG) return reply.code(403).send({ error: 'OIDC profile is missing sub/email or no default tenant is configured' });

    const issuer = config.OIDC_ISSUER_URL!;
    const tenant = await prisma.tenant.findUnique({ where: { slug: config.OIDC_DEFAULT_TENANT_SLUG } });
    if (!tenant) return reply.code(503).send({ error: 'Configured OIDC tenant does not exist' });
    const user = await prisma.$transaction(async tx => {
      const existing = await tx.user.findUnique({ where: { issuer_subject: { issuer, subject: profile.sub! } } });
      if (existing) return tx.user.update({ where: { id: existing.id }, data: { email: profile.email!, name: profile.name ?? profile.preferred_username ?? existing.name } });
      const userCount = await tx.user.count({ where: { tenantId: tenant.id } });
      return tx.user.create({ data: { tenantId: tenant.id, issuer, subject: profile.sub!, email: profile.email!, name: profile.name ?? profile.preferred_username, role: userCount === 0 ? 'OWNER' : 'OPERATOR' } });
    });
    const session = await createSession(user.id);
    return reply.header('set-cookie', [clearStateCookie(), session]).redirect(config.DASHBOARD_URL);
  });

  app.get('/auth/me', async (request, reply) => {
    const user = await authenticateSession(getCookie(request.headers.cookie, SESSION_COOKIE));
    if (!user) return reply.code(401).send({ error: 'Not authenticated' });
    return reply.send({ user: { id: user.id, name: user.name, tenantId: user.tenantId, role: user.role } });
  });

  app.post('/auth/logout', async (request, reply) => {
    await destroySession(getCookie(request.headers.cookie, SESSION_COOKIE), reply);
    return reply.code(204).send();
  });
}
