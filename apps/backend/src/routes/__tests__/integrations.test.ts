import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { TenantRole } from '@prisma/client';
import type { AuthenticatedRequest } from '../../utils/auth-context.js';
import { integrationRoutes } from '../integrations.js';

const fake = vi.hoisted(() => ({
  created: null as Record<string, unknown> | null,
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    integration: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        fake.created = data;
        return {
          id: 'integration-created',
          ...data,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        };
      },
    },
    driftDetectionConfig: {
      upsert: async () => ({ id: 'drift-config-created' }),
    },
  },
}));

beforeEach(() => {
  fake.created = null;
});

describe('POST /integrations', () => {
  it('does not return the generated webhook secret', async () => {
    const app = Fastify();
    app.addHook('onRequest', async request => {
      (request as AuthenticatedRequest).shapiAuth = {
        id: 'test-key',
        name: 'Test key',
        tenantId: 'tenant-a',
        role: 'OWNER' as TenantRole,
        permissions: ['*'],
      };
    });
    await integrationRoutes(app);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/integrations',
        payload: { name: 'Payments', type: 'STRIPE' },
      });
      const body = response.json();

      expect(response.statusCode).toBe(201);
      expect(body).toMatchObject({
        id: 'integration-created',
        tenantId: 'tenant-a',
        name: 'Payments',
        type: 'STRIPE',
        webhookSecretConfigured: true,
      });
      expect(body).not.toHaveProperty('webhookSecret');
      expect(fake.created?.webhookSecret).toMatch(/^whsec_[a-f0-9]{64}$/);
    } finally {
      await app.close();
    }
  });
});
