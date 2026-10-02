import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import crypto from 'node:crypto';

const fake = vi.hoisted(() => ({
  authenticateSession: vi.fn(),
  createSession: vi.fn(),
  destroySession: vi.fn(),
  oidcEnabled: vi.fn(),
  prisma: {
    tenant: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../utils/auth-sessions.js', () => ({
  authenticateSession: fake.authenticateSession,
  createSession: fake.createSession,
  destroySession: fake.destroySession,
  getCookie: (header: string | undefined, name: string) => header
    ?.split(';')
    .map(value => value.trim())
    .find(value => value.startsWith(`${name}=`))
    ?.slice(name.length + 1),
  oidcEnabled: fake.oidcEnabled,
  SESSION_COOKIE: 'shapi_session',
}));

vi.mock('../../utils/prisma.js', () => ({ prisma: fake.prisma }));
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
    fake.createSession.mockReset();
    fake.destroySession.mockReset();
    fake.oidcEnabled.mockReset();
    fake.prisma.tenant.findUnique.mockReset();
    fake.prisma.$transaction.mockReset();
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

  it('returns a controlled error when OIDC discovery is unavailable', async () => {
    fake.oidcEnabled.mockReturnValue(true);
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('provider unavailable'));

    const response = await app.inject({ method: 'GET', url: '/auth/login' });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'OIDC provider discovery unavailable' });
  });

  it('exchanges a valid OIDC callback, creates a tenant user session, and redirects safely', async () => {
    fake.oidcEnabled.mockReturnValue(true);
    fake.prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
    const createdUser = { id: 'user-1' };
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue(createdUser),
      },
    };
    fake.prisma.$transaction.mockImplementation(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx));

    const state = 'state-from-browser';
    const signature = crypto.createHmac('sha256', 'test-jwt-secret').update(state).digest('base64url');
    const providerRequest = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        authorization_endpoint: 'https://issuer.example.test/authorize',
        token_endpoint: 'https://issuer.example.test/token',
        userinfo_endpoint: 'https://issuer.example.test/userinfo',
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'provider-access-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sub: 'subject-1', email: 'owner@example.com', name: 'Owner' }), { status: 200 }));

    const response = await app.inject({
      method: 'GET',
      url: `/auth/callback?code=authorization-code&state=${state}`,
      headers: { cookie: `shapi_oidc_state=${state}.${signature}` },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('http://dashboard.example.test');
    expect(fake.prisma.tenant.findUnique).toHaveBeenCalledWith({ where: { slug: 'tenant' } });
    expect(tx.user.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        issuer: 'https://issuer.example.test',
        subject: 'subject-1',
        email: 'owner@example.com',
        name: 'Owner',
        role: 'OWNER',
      },
    });
    expect(fake.createSession).toHaveBeenCalledWith('user-1', expect.anything());
    expect(providerRequest).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(response.headers)).not.toContain('provider-access-token');
  });

  it('returns a controlled error when the OIDC token endpoint is unavailable', async () => {
    fake.oidcEnabled.mockReturnValue(true);
    const state = 'state-for-provider-outage';
    const signature = crypto.createHmac('sha256', 'test-jwt-secret').update(state).digest('base64url');
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('provider unavailable'));

    const response = await app.inject({
      method: 'GET',
      url: `/auth/callback?code=authorization-code&state=${state}`,
      headers: { cookie: `shapi_oidc_state=${state}.${signature}` },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'OIDC token exchange unavailable' });
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
