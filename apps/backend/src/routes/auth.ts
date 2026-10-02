import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { config } from '../config.js';
import {
  authenticateSession,
  createSession,
  destroySession,
  getCookie,
  oidcEnabled,
  sessionCookie,
  SESSION_COOKIE,
} from '../utils/auth-sessions.js';

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

export async function authRoutes(app: FastifyInstance) {
  app.get('/auth/config', async (_request, reply) => reply.send({ oidcEnabled: oidcEnabled() }));

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
