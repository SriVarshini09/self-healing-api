import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { TenantRole } from '@prisma/client';
import type { AuthenticatedRequest } from '../../utils/auth-context.js';
import { incidentRoutes } from '../incidents.js';

const fake = vi.hoisted(() => ({
  incident: { id: 'inc-1', integrationId: 'int-1', status: 'DETECTED', rootCause: null as string | null, suggestedFix: null as string | null },
  candidates: [] as Array<{ id: string; incidentId: string; description: string }>,
  replayJobs: [] as Array<{ id: string; incidentId: string; webhookEventId: string }>,
  diagnosisCalls: 0,
  changeDuringDiagnosis: false,
  changeDuringReplay: false,
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    incident: {
      findUnique: async () => ({ ...fake.incident, invariant: null, integration: { id: 'int-1', tenantId: 'tenant-1', type: 'STRIPE', config: {} } }),
      findFirst: async () => ({ ...fake.incident }),
    },
    webhookEvent: {
      findUnique: async () => {
        if (fake.changeDuringReplay) fake.incident.status = 'RESOLVED';
        return { id: 'event-1', integrationId: 'int-1' };
      },
    },
    replayJob: { findUnique: async () => null },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
      incident: {
        updateMany: async ({ where, data }: { where: { status: string | { in: string[] } }; data: Record<string, unknown> }) => {
          const allowed = typeof where.status === 'string' ? fake.incident.status === where.status : where.status.in.includes(fake.incident.status);
          if (!allowed) return { count: 0 };
          Object.assign(fake.incident, data);
          return { count: 1 };
        },
        findUniqueOrThrow: async () => ({ ...fake.incident }),
      },
      repairCandidate: {
        create: async ({ data }: { data: { incidentId: string; description: string } }) => {
          const candidate = { id: `candidate-${fake.candidates.length + 1}`, incidentId: data.incidentId, description: data.description };
          fake.candidates.push(candidate);
          return candidate;
        },
      },
      replayJob: {
        create: async ({ data }: { data: { incidentId: string; webhookEventId: string } }) => {
          const job = { id: `job-${fake.replayJobs.length + 1}`, incidentId: data.incidentId, webhookEventId: data.webhookEventId };
          fake.replayJobs.push(job);
          return job;
        },
      },
    }),
  },
}));

vi.mock('../../services/diagnosis.js', () => ({
  diagnoseIncident: async () => {
    fake.diagnosisCalls++;
    if (fake.changeDuringDiagnosis) fake.incident.status = 'RESOLVED';
    return { rootCause: 'Webhook drift', suggestedFix: 'Review handler', confidence: 0.8, evidence: [] };
  },
}));

vi.mock('../../services/repair.js', () => ({
  generateRepairCandidates: async () => [{ type: 'MANUAL', description: 'Review handler', diff: null, files: [], confidence: 0.8 }],
}));

let app: FastifyInstance;

beforeEach(async () => {
  Object.assign(fake.incident, { status: 'DETECTED', rootCause: null, suggestedFix: null });
  fake.candidates.length = 0;
  fake.replayJobs.length = 0;
  fake.diagnosisCalls = 0;
  fake.changeDuringDiagnosis = false;
  fake.changeDuringReplay = false;
  app = Fastify();
  app.addHook('onRequest', async request => {
    (request as AuthenticatedRequest).shapiAuth = {
      id: 'test-key', name: 'Test key', tenantId: 'tenant-1', role: 'OWNER' as TenantRole, permissions: ['*'],
    };
  });
  await incidentRoutes(app);
  await app.ready();
});

afterEach(async () => { await app.close(); });

describe('incident lifecycle actions', () => {
  it('rejects diagnosis of a resolved incident without changing its state', async () => {
    fake.incident.status = 'RESOLVED';
    const response = await app.inject({ method: 'POST', url: '/incidents/inc-1/diagnose' });
    expect(response.statusCode).toBe(409);
    expect(fake.diagnosisCalls).toBe(0);
    expect(fake.candidates).toHaveLength(0);
    expect(fake.incident.status).toBe('RESOLVED');
  });

  it('persists one diagnosis and rejects duplicate candidates', async () => {
    const first = await app.inject({ method: 'POST', url: '/incidents/inc-1/diagnose' });
    expect(first.statusCode).toBe(200);
    expect(first.json().candidates[0].id).toBe('candidate-1');
    const second = await app.inject({ method: 'POST', url: '/incidents/inc-1/diagnose' });
    expect(second.statusCode).toBe(409);
    expect(fake.diagnosisCalls).toBe(1);
    expect(fake.candidates).toHaveLength(1);
    expect(fake.incident.status).toBe('TRIAGED');
  });

  it('does not save candidates if the incident resolves during diagnosis', async () => {
    fake.changeDuringDiagnosis = true;
    const response = await app.inject({ method: 'POST', url: '/incidents/inc-1/diagnose' });
    expect(response.statusCode).toBe(409);
    expect(fake.candidates).toHaveLength(0);
    expect(fake.incident.status).toBe('RESOLVED');
  });

  it('replays a triaged incident but rejects a resolved one', async () => {
    fake.incident.status = 'TRIAGED';
    const first = await app.inject({ method: 'POST', url: '/incidents/inc-1/replay', payload: { webhookEventId: 'event-1', fixCandidate: 'add_field:status:"paid"' } });
    expect(first.statusCode).toBe(201);
    expect(fake.incident.status).toBe('REPLAYING');
    expect(fake.replayJobs).toHaveLength(1);

    fake.incident.status = 'RESOLVED';
    const second = await app.inject({ method: 'POST', url: '/incidents/inc-1/replay', payload: { webhookEventId: 'event-1', fixCandidate: 'add_field:status:"paid"' } });
    expect(second.statusCode).toBe(409);
    expect(fake.replayJobs).toHaveLength(1);
    expect(fake.incident.status).toBe('RESOLVED');
  });

  it('does not queue replay if the incident resolves while loading the webhook', async () => {
    fake.incident.status = 'TRIAGED';
    fake.changeDuringReplay = true;
    const response = await app.inject({ method: 'POST', url: '/incidents/inc-1/replay', payload: { webhookEventId: 'event-1', fixCandidate: 'add_field:status:"paid"' } });
    expect(response.statusCode).toBe(409);
    expect(fake.replayJobs).toHaveLength(0);
    expect(fake.incident.status).toBe('RESOLVED');
  });
});
