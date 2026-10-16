import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { TenantRole } from '@prisma/client';
import type { AuthenticatedRequest } from '../../utils/auth-context.js';
import { incidentRoutes } from '../incidents.js';

const fake = vi.hoisted(() => ({
  incident: {
    id: 'inc-1', integrationId: 'int-1', status: 'DETECTED', rootCause: null as string | null, suggestedFix: null as string | null,
    triagedAt: null as Date | null, resolvedAt: null as Date | null,
  },
  lastUpdate: null as Record<string, unknown> | null,
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
      update: async ({ data }: { data: Record<string, unknown> }) => {
        fake.lastUpdate = data;
        Object.assign(fake.incident, data);
        return { ...fake.incident, integration: null, invariant: null, replayJobs: [], repairCandidates: [], githubPRs: [] };
      },
    },
    webhookEvent: {
      findFirst: async ({ where }: { where: { id: string; integrationId: string } }) => {
        if (fake.changeDuringReplay) fake.incident.status = 'RESOLVED';
        return where.id === 'event-1' && where.integrationId === 'int-1' ? { id: 'event-1', integrationId: 'int-1' } : null;
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

vi.mock('../../services/alert-queue.js', () => ({ queueIncidentAlert: vi.fn(async () => undefined) }));

vi.mock('../../services/diagnosis.js', () => ({
  diagnoseIncident: async () => {
    fake.diagnosisCalls++;
    if (fake.changeDuringDiagnosis) fake.incident.status = 'RESOLVED';
    return { rootCause: 'Webhook drift', suggestedFix: 'Review handler', confidence: 0.8, evidence: [] };
  },
}));

vi.mock('../../services/repair.js', () => ({
  generateRepairCandidates: async () => [{ type: 'MANUAL', description: 'Review handler', diff: null, files: [], confidence: 0.8 }],
  repairCandidateReadiness: () => ({
    reviewStatus: 'MANUAL_REVIEW',
    automationEligible: false,
    reviewReason: 'No repository mapping is configured',
  }),
}));

let app: FastifyInstance;

beforeEach(async () => {
  Object.assign(fake.incident, { status: 'DETECTED', rootCause: null, suggestedFix: null, triagedAt: null, resolvedAt: null });
  fake.lastUpdate = null;
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
    expect(first.json().candidates[0]).toMatchObject({
      reviewStatus: 'MANUAL_REVIEW',
      automationEligible: false,
    });
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

describe('PATCH /incidents/:id keeps timestamps truthful', () => {
  const patch = (payload: Record<string, unknown>) => app.inject({ method: 'PATCH', url: '/incidents/inc-1', payload });

  it('stamps resolvedAt when an incident is resolved', async () => {
    fake.incident.status = 'TRIAGED';
    expect((await patch({ status: 'RESOLVED' })).statusCode).toBe(200);
    expect(fake.lastUpdate?.resolvedAt).toBeInstanceOf(Date);
  });

  it('does not rewrite resolvedAt when the same status is saved again', async () => {
    const original = new Date('2026-10-01T00:00:00Z');
    Object.assign(fake.incident, { status: 'RESOLVED', resolvedAt: original });
    await patch({ status: 'RESOLVED', rootCause: 'edited note' });
    expect(fake.lastUpdate).not.toHaveProperty('resolvedAt');
    expect(fake.incident.resolvedAt).toEqual(original);
  });

  it('clears resolvedAt when a resolved incident is reopened', async () => {
    Object.assign(fake.incident, { status: 'RESOLVED', resolvedAt: new Date('2026-10-01T00:00:00Z') });
    await patch({ status: 'TRIAGED' });
    expect(fake.lastUpdate?.resolvedAt).toBeNull();
  });

  it('keeps the first triage time', async () => {
    const first = new Date('2026-10-01T00:00:00Z');
    Object.assign(fake.incident, { status: 'TRIAGED', triagedAt: first });
    await patch({ status: 'TRIAGED' });
    await patch({ status: 'REPLAYING' });
    await patch({ status: 'TRIAGED' });
    expect(fake.incident.triagedAt).toEqual(first);
  });
});

describe('POST /incidents/:id/replay event scoping', () => {
  it('answers 404 for an event that is not this incident\'s, same as a missing one', async () => {
    fake.incident.status = 'TRIAGED';
    const other = await app.inject({ method: 'POST', url: '/incidents/inc-1/replay', payload: { webhookEventId: 'event-of-another-workspace', fixCandidate: 'add_field:status:"paid"' } });
    expect(other.statusCode).toBe(404);
    expect(fake.replayJobs).toHaveLength(0);
  });
});
