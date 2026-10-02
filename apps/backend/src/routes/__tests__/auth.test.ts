import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const fake = vi.hoisted(() => ({
  authenticateSession: vi.fn(),
  destroySession: vi.fn(),
  oidcEnabled: vi.fn(),
}));

vi.mock('../../utils/auth-sessions.js', () => ({
  authenticateSession: fake.authenticateSession,
  createSession: vi.fn(),
  destroySession: fake.destroySession,
  getCookie: (header: string | undefined, name: string) => header
    ?.split(';')
    .map(value => value.trim())
    .find(value => value.startsWith(`${name}=`))
    ?.slice(name.length + 1),
  oidcEnabled: fake.oidcEnabled,
  SESSION_COOKIE: 'shapi_session',
}));

vi.mock('../../utils/prisma.js', () => ({ prisma: {} }));
vi.mock('../../config.js', () => ({
  config: {
    DASHBOARD_URL: 'http://dashboard.example.test',
    JWT_SECRET: 'test-jwt-secret',
    NODE_ENV: 'development',
    OIDC_CLIENT_ID: 'client-id',
    OIDC_CLIENT_SECRET: 'client-secret',
    OIDC_DEFAULT_TENANT_SLUG: 'tenant',
    OIDC_ISSUER_URL: 'https://issuer.example.test',
    OIDC_REDIRECT_URI: 'http://api.example.test/api/v1/auth/callback',
    OIDC_SCOPES: 'openid profile email',
  },
}));

import { authRoutes } from '../auth.js';

describe('authentication routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    fake.authenticateSession.mockReset();
    fake.destroySession.mockReset();
    fake.oidcEnabled.mockReset();
    fake.oidcEnabled.mockReturnValue(false);
    app = Fastify();
    await authRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('reports whether OIDC is enabled and fails closed when it is disabled', async () => {
    await expect(app.inject({ method: 'GET', url: '/auth/config' })).resolves.toMatchObject({
      statusCode: 200,
      body: '{"oidcEnabled":false}',
    });
    expect((await app.inject({ method: 'GET', url: '/auth/login' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/auth/callback?code=code&state=state' })).statusCode).toBe(404);
  });

  it('returns 401 when no browser session exists', async () => {
    fake.authenticateSession.mockResolvedValue(null);

    const response = await app.inject({ method: 'GET', url: '/auth/me' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Not authenticated' });
    expect(fake.authenticateSession).toHaveBeenCalledWith(undefined);
  });

  it('rejects an OIDC callback with invalid state before contacting the provider', async () => {
    fake.oidcEnabled.mockReturnValue(true);
    const providerRequest = vi.spyOn(globalThis, 'fetch');

    const response = await app.inject({
      method: 'GET',
      url: '/auth/callback?code=authorization-code&state=unexpected-state',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'Invalid OIDC callback state' });
    expect(providerRequest).not.toHaveBeenCalled();
  });

  it('returns the tenant-scoped session user without exposing session data', async () => {
    fake.authenticateSession.mockResolvedValue({
      id: 'user-1',
      name: 'Owner',
      email: 'owner@example.com',
      tenantId: 'tenant-1',
      role: 'OWNER',
      permissions: ['read', 'write'],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: 'shapi_session=session-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ user: { id: 'user-1', name: 'Owner', tenantId: 'tenant-1', role: 'OWNER' } });
    expect(JSON.stringify(response.json())).not.toContain('session-token');
    expect(fake.authenticateSession).toHaveBeenCalledWith('session-token');
  });

  it('delegates logout to session destruction and clears the session cookie', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: 'shapi_session=session-token' },
    });

    expect(response.statusCode).toBe(204);
    expect(fake.destroySession).toHaveBeenCalledWith('session-token', expect.anything());
  });
});
