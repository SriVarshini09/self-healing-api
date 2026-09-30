import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { TenantRole } from '@prisma/client';
import type { AuthenticatedRequest } from '../../utils/auth-context.js';
import { invariantRoutes } from '../invariants.js';

const fake = vi.hoisted(() => ({
  counts: new Map<string, number>(),
  lockKeys: [] as string[],
}));

vi.mock('../../config.js', () => ({ config: { SHAPI_MAX_INVARIANTS_PER_TENANT: 2 } }));
vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
      $queryRaw: async (_query: TemplateStringsArray, tenantId: string) => {
        fake.lockKeys.push(tenantId);
        return [];
      },
      integration: {
        findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
          where.id === `int-${where.tenantId}` ? { id: where.id } : null,
      },
      invariant: {
        count: async ({ where }: { where: { integration: { tenantId: string } } }) =>
          fake.counts.get(where.integration.tenantId) ?? 0,
        create: async ({ data }: { data: { integrationId: string; predicateExpression: string } }) => {
          const tenantId = data.integrationId.slice(4);
          const count = (fake.counts.get(tenantId) ?? 0) + 1;
          fake.counts.set(tenantId, count);
          return { id: `inv-${tenantId}-${count}`, ...data };
        },
      },
    }),
  },
}));

beforeEach(() => {
  fake.counts.clear();
  fake.lockKeys.length = 0;
});

async function createInvariant(tenantId: string, integrationId = `int-${tenantId}`) {
  const app = Fastify();
  app.addHook('onRequest', async request => {
    (request as AuthenticatedRequest).shapiAuth = {
      id: 'test-key', name: 'Test key', tenantId,
      role: 'OWNER' as TenantRole, permissions: ['*'],
    };
  });
  await invariantRoutes(app);
  try {
    return await app.inject({
      method: 'POST', url: '/invariants',
      payload: {
        integrationId,
        name: 'Test invariant',
        predicateExpression: 'event.payload.ok === true',
      },
    });
  } finally {
    await app.close();
  }
}

describe('POST /invariants tenant quota', () => {
  it('caps creation for one tenant and serializes the count and insert', async () => {
    expect((await createInvariant('tenant-a')).statusCode).toBe(201);
    expect((await createInvariant('tenant-a')).statusCode).toBe(201);
    const rejected = await createInvariant('tenant-a');
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json()).toMatchObject({ error: 'Invariant quota reached for this tenant', limit: 2 });
    expect(fake.counts.get('tenant-a')).toBe(2);
    expect(fake.lockKeys).toEqual(['tenant-a', 'tenant-a', 'tenant-a']);
  });

  it('counts each tenant separately and rejects another tenant\'s integration', async () => {
    expect((await createInvariant('tenant-a')).statusCode).toBe(201);
    expect((await createInvariant('tenant-b', 'int-tenant-a')).statusCode).toBe(404);
    expect((await createInvariant('tenant-b')).statusCode).toBe(201);
    expect(fake.counts.get('tenant-a')).toBe(1);
    expect(fake.counts.get('tenant-b')).toBe(1);
  });
});
