import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { TenantRole } from '@prisma/client';
import type { AuthenticatedRequest } from '../../utils/auth-context.js';
import { alertRoutes } from '../alerts.js';

const fake = vi.hoisted(() => ({
  whereClauses: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../config.js', () => ({
  config: { ALERT_WEBHOOK_URL: 'https://alerts.example.test/hooks/shapi' },
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    alertDelivery: {
      count: async ({ where }: { where: Record<string, unknown> }) => {
        fake.whereClauses.push(where);
        return 1;
      },
    },
  },
}));

describe('alert status tenant isolation', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    fake.whereClauses.length = 0;
    app = Fastify();
    app.addHook('onRequest', async request => {
      (request as AuthenticatedRequest).shapiAuth = {
        id: 'test-key',
        name: 'Test key',
        tenantId: 'tenant-42',
        role: 'OWNER' as TenantRole,
        permissions: ['*'],
      };
    });
    await alertRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('scopes every outbox count to the authenticated tenant', async () => {
    const response = await app.inject({ method: 'GET', url: '/alerts/status' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      webhookConfigured: true,
      pending: 1,
      retrying: 1,
      delivered: 1,
      failed: 1,
    });
    expect(fake.whereClauses).toHaveLength(4);
    for (const where of fake.whereClauses) {
      expect(where).toMatchObject({
        incident: { integration: { tenantId: 'tenant-42' } },
      });
    }
  });
});
