import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { Prisma } from '@prisma/client';
import type { TenantRole } from '@prisma/client';
import type { AuthenticatedRequest } from '../../utils/auth-context.js';
import { invariantRoutes } from '../invariants.js';

const fake = vi.hoisted(() => ({
  counts: new Map<string, number>(),
  lockKeys: [] as string[],
  invariants: new Map<string, { id: string; predicateExpression: string; repairRepository: string | null; repairFilePath: string | null; repairRequiredChecks: string[] }>(),
  githubPrs: [] as Array<{ incident: { invariantId: string }; status: string; verified: boolean; verifiedAt: Date | null; verificationHeadSha: string | null; verificationChecks: unknown }>,
}));

vi.mock('../../config.js', () => ({ config: { SHAPI_MAX_INVARIANTS_PER_TENANT: 2 } }));
vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    invariant: {
      findFirst: async ({ where }: { where: { id: string } }) => fake.invariants.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: { repairRepository?: string | null; repairFilePath?: string | null } }) => {
        const invariant = fake.invariants.get(where.id)!;
        Object.assign(invariant, data);
        return invariant;
      },
    },
    gitHubPullRequest: {
      updateMany: async ({ where, data }: { where: { incident: { invariantId: string }; status: { in: string[] } }; data: Record<string, unknown> }) => {
        let count = 0;
        for (const pr of fake.githubPrs) {
          if (pr.incident.invariantId === where.incident.invariantId && where.status.in.includes(pr.status)) {
            Object.assign(pr, data);
            count += 1;
          }
        }
        return { count };
      },
    },
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
          const invariant = { id: `inv-${tenantId}-${count}`, repairRepository: null, repairFilePath: null, repairRequiredChecks: [], ...data, predicateExpression: data.predicateExpression ?? 'event.payload.ok === true' };
          fake.invariants.set(invariant.id, invariant);
          return invariant;
        },
      },
    }),
  },
}));

beforeEach(() => {
  fake.counts.clear();
  fake.lockKeys.length = 0;
  fake.invariants.clear();
  fake.githubPrs.length = 0;
});

async function createInvariant(tenantId: string, integrationId = `int-${tenantId}`, repairTarget: Record<string, unknown> = {}) {
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
        ...repairTarget,
      },
    });
  } finally {
    await app.close();
  }
}

async function patchInvariant(id: string, payload: Record<string, unknown>) {
  const app = Fastify();
  app.addHook('onRequest', async request => {
    (request as AuthenticatedRequest).shapiAuth = {
      id: 'test-key', name: 'Test key', tenantId: 'tenant-a', role: 'OWNER' as TenantRole, permissions: ['*'],
    };
  });
  await invariantRoutes(app);
  try {
    return await app.inject({ method: 'PATCH', url: `/invariants/${id}`, payload });
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

  it('requires a canonical repository and file path together', async () => {
    expect((await createInvariant('tenant-a', 'int-tenant-a', { repairRepository: 'acme/demo' })).statusCode).toBe(400);
    expect((await createInvariant('tenant-a', 'int-tenant-a', { repairRepository: 'acme/demo', repairFilePath: '../outside.ts' })).statusCode).toBe(400);
    expect((await createInvariant('tenant-a', 'int-tenant-a', { repairRepository: 'acme/demo', repairFilePath: 'src/invariants/pay.ts' })).statusCode).toBe(400);
    const created = await createInvariant('tenant-a', 'int-tenant-a', { repairRepository: 'acme/demo', repairFilePath: 'src/invariants/pay.ts', repairRequiredChecks: ['target-tests'] });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ repairRepository: 'acme/demo', repairFilePath: 'src/invariants/pay.ts', repairRequiredChecks: ['target-tests'] });
    expect((await patchInvariant(created.json().id, { repairFilePath: 'other.ts' })).statusCode).toBe(200);
    expect((await patchInvariant(created.json().id, { repairRequiredChecks: [] })).statusCode).toBe(400);
    expect((await patchInvariant(created.json().id, { repairRepository: null })).statusCode).toBe(400);
    expect((await patchInvariant(created.json().id, { repairRepository: null, repairFilePath: null })).statusCode).toBe(200);
  });

  it('requires the business-outcome check for the reviewed provisioning adapter', async () => {
    const created = await createInvariant('tenant-a', 'int-tenant-a');
    const createdId = created.json().id as string;
    const invariant = fake.invariants.get(createdId)!;
    fake.invariants.delete(createdId);
    invariant.id = 'inv-stripe-provisioning';
    fake.invariants.set(invariant.id, invariant);

    const target = {
      repairRepository: 'SriVarshini09/self-healing-api',
      repairFilePath: 'apps/demo-saas/src/business-outcome.ts',
    };
    expect((await patchInvariant(invariant.id, { ...target, repairRequiredChecks: ['verify'] })).statusCode).toBe(400);
    expect((await patchInvariant(invariant.id, { ...target, repairRequiredChecks: ['verify', 'business-outcome'] })).statusCode).toBe(200);
  });

  it('invalidates stale verification when an actionable repair target changes', async () => {
    const created = await createInvariant('tenant-a', 'int-tenant-a', {
      repairRepository: 'acme/demo',
      repairFilePath: 'src/invariants/pay.ts',
      repairRequiredChecks: ['target-tests'],
    });
    const invariantId = created.json().id as string;
    fake.githubPrs.push(
      {
        incident: { invariantId }, status: 'OPEN', verified: true, verifiedAt: new Date(),
        verificationHeadSha: 'head-sha', verificationChecks: [{ name: 'target-tests', conclusion: 'success' }],
      },
      {
        incident: { invariantId }, status: 'MERGED', verified: true, verifiedAt: new Date(),
        verificationHeadSha: 'merged-sha', verificationChecks: [{ name: 'target-tests', conclusion: 'success' }],
      },
    );

    expect((await patchInvariant(invariantId, { repairRequiredChecks: ['target-tests', 'business-outcome'] })).statusCode).toBe(200);
    expect(fake.githubPrs[0]).toMatchObject({ verified: false, verifiedAt: null, verificationHeadSha: null, verificationChecks: Prisma.DbNull });
    expect(fake.githubPrs[1]).toMatchObject({ verified: true, verificationHeadSha: 'merged-sha' });
  });
});
