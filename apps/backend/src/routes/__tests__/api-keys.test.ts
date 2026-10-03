import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { bootstrapRoutes } from '../api-keys.js';

const fake = vi.hoisted(() => ({
  tenantData: null as Record<string, unknown> | null,
  keyData: null as Record<string, unknown> | null,
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
      tenant: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          fake.tenantData = data;
          return { id: 'tenant-onboarded', ...data };
        },
      },
      aPIKey: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          fake.keyData = data;
          return {
            id: 'key-onboarded',
            name: data.name,
            prefix: data.prefix,
            permissions: data.permissions,
            role: data.role,
            expiresAt: data.expiresAt ?? null,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            lastUsedAt: null,
          };
        },
      },
    }),
  },
}));

describe('tenant bootstrap', () => {
  let app: FastifyInstance;
  const originalToken = process.env.SHAPI_BOOTSTRAP_TOKEN;

  beforeEach(async () => {
    process.env.SHAPI_BOOTSTRAP_TOKEN = 'test-bootstrap-token-with-more-than-32-characters';
    fake.tenantData = null;
    fake.keyData = null;
    app = Fastify();
    await bootstrapRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    if (originalToken === undefined) delete process.env.SHAPI_BOOTSTRAP_TOKEN;
    else process.env.SHAPI_BOOTSTRAP_TOKEN = originalToken;
  });

  it('rejects missing and invalid bootstrap credentials', async () => {
    delete process.env.SHAPI_BOOTSTRAP_TOKEN;
    const missing = await app.inject({ method: 'POST', url: '/bootstrap/tenant', payload: {} });
    expect(missing.statusCode).toBe(404);

    process.env.SHAPI_BOOTSTRAP_TOKEN = 'test-bootstrap-token-with-more-than-32-characters';
    const invalid = await app.inject({
      method: 'POST',
      url: '/bootstrap/tenant',
      headers: { 'x-bootstrap-token': 'wrong-token' },
      payload: {},
    });
    expect(invalid.statusCode).toBe(401);
  });

  it('creates a tenant and returns the owner key only at bootstrap time', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/bootstrap/tenant',
      headers: { 'x-bootstrap-token': 'test-bootstrap-token-with-more-than-32-characters' },
      payload: {
        tenantName: 'Acme Payments',
        slug: 'acme-payments',
        keyName: 'Acme owner',
        permissions: ['read', 'write', 'read'],
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body.tenant).toEqual({ id: 'tenant-onboarded', name: 'Acme Payments', slug: 'acme-payments' });
    expect(body.key).toMatch(/^shapi_[A-Za-z0-9_-]+$/);
    expect(body.apiKey).toMatchObject({ id: 'key-onboarded', role: 'OWNER', permissions: ['read', 'write'] });
    expect(body.warning).toMatch(/never stores or returns the raw key again/);
    expect(fake.tenantData).toEqual({ name: 'Acme Payments', slug: 'acme-payments' });
    expect(fake.keyData).toMatchObject({ tenantId: 'tenant-onboarded', name: 'Acme owner', role: 'OWNER', permissions: ['read', 'write'] });
    expect(JSON.stringify(body.apiKey)).not.toContain(body.key);
  });

  it('validates the tenant slug before opening the transaction', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/bootstrap/tenant',
      headers: { 'x-bootstrap-token': 'test-bootstrap-token-with-more-than-32-characters' },
      payload: { tenantName: 'Acme', slug: 'Not A Slug' },
    });

    expect(response.statusCode).toBe(400);
    expect(fake.tenantData).toBeNull();
    expect(fake.keyData).toBeNull();
  });
});
