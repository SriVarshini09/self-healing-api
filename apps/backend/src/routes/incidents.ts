import type { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma.js';
import type {
  Prisma,
  RepairType} from '@prisma/client';
import {
  IncidentSeverity,
  IncidentStatus,
  ReplayJobResult,
  ReplayJobStatus,
} from '@prisma/client';
import { z } from 'zod';
import { tenantIdFor } from '../utils/auth-context.js';

const replaySchema = z.object({
  webhookEventId: z.string().min(1),
  fixCandidate: z.string().trim().min(1).max(20_000),
});

const incidentPatchSchema = z.object({
  status: z.nativeEnum(IncidentStatus).optional(),
  rootCause: z.string().max(20_000).optional(),
  suggestedFix: z.string().max(20_000).optional(),
  githubPrUrl: z.string().url().max(2_000).nullable().optional(),
}).strict();

export async function incidentRoutes(app: FastifyInstance) {
  app.get('/incidents', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const q = (request.query ?? {}) as Record<string, unknown>;
    const page = Number(q.page ?? 1) || 1;
    const pageSize = Math.min(Number(q.pageSize ?? 20) || 20, 100);

    const where: Prisma.IncidentWhereInput = { integration: { tenantId } };
    if (typeof q.integrationId === 'string') where.integrationId = q.integrationId;
    if (typeof q.invariantId === 'string') where.invariantId = q.invariantId;
    if (typeof q.status === 'string' && (Object.values(IncidentStatus) as string[]).includes(q.status)) {
      where.status = q.status as IncidentStatus;
    }
    if (typeof q.severity === 'string' && (Object.values(IncidentSeverity) as string[]).includes(q.severity)) {
      where.severity = q.severity as IncidentSeverity;
    }

    const [incidents, total] = await Promise.all([
      prisma.incident.findMany({
        where,
        orderBy: { detectedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          integration: { select: { id: true, name: true, type: true } },
          invariant: { select: { id: true, name: true } },
          replayJobs: true,
          repairCandidates: true,
          githubPRs: true,
        },
      }),
      prisma.incident.count({ where }),
    ]);

    return reply.send({
      data: incidents,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  });

  app.get('/incidents/:id', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { id } = (request.params ?? {}) as { id: string };
    const incident = await prisma.incident.findUnique({
      where: { id, integration: { tenantId } },
      include: {
        integration: { select: { id: true, name: true, type: true, webhookEnabled: true } },
        invariant: true,
        replayJobs: { orderBy: { createdAt: 'desc' } },
        repairCandidates: { orderBy: { createdAt: 'desc' } },
        githubPRs: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!incident) return reply.code(404).send({ error: 'Incident not found' });
    return reply.send(incident);
  });

  app.patch('/incidents/:id', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { id } = (request.params ?? {}) as { id: string };
    const parsed = incidentPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid incident payload', details: parsed.error.flatten() });
    const data = parsed.data;

    const updateData: Prisma.IncidentUpdateInput = { ...data };
    if (data.status === IncidentStatus.TRIAGED) updateData.triagedAt = new Date();
    if (data.status === IncidentStatus.RESOLVED) updateData.resolvedAt = new Date();

    const existing = await prisma.incident.findFirst({ where: { id, integration: { tenantId } } });
    if (!existing) return reply.code(404).send({ error: 'Incident not found' });
    const incident = await prisma.incident.update({
      where: { id },
      data: updateData,
      include: {
        integration: { select: { id: true, name: true, type: true, webhookEnabled: true } },
        invariant: true,
        replayJobs: true,
        repairCandidates: true,
        githubPRs: true,
      },
    });
    return reply.send(incident);
  });

  app.get('/incidents/:id/timeline', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { id } = (request.params ?? {}) as { id: string };
    const incident = await prisma.incident.findUnique({
      where: { id, integration: { tenantId } },
      include: {
        replayJobs: { orderBy: { createdAt: 'asc' } },
        repairCandidates: { orderBy: { createdAt: 'asc' } },
        githubPRs: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!incident) return reply.code(404).send({ error: 'Incident not found' });

    const timeline = [
      {
        type: 'detected',
        timestamp: incident.detectedAt,
        message: 'Incident detected',
        data: { severity: incident.severity },
      },
      ...(incident.triagedAt
        ? [
            {
              type: 'triaged',
              timestamp: incident.triagedAt,
              message: 'Incident triaged',
              data: { rootCause: incident.rootCause },
            },
          ]
        : []),
      ...incident.replayJobs.map(job => ({
        type: 'replay',
        timestamp: job.createdAt,
        message: `Replay job ${String(job.status).toLowerCase()}`,
        data: { fixCandidate: job.fixCandidate, result: job.result },
      })),
      ...incident.repairCandidates.map(rc => ({
        type: 'repair_candidate',
        timestamp: rc.createdAt,
        message: `Repair candidate: ${String(rc.type).toLowerCase().replace('_', ' ')}`,
        data: { description: rc.description, confidence: rc.confidence, verified: rc.verified },
      })),
      ...incident.githubPRs.map(pr => ({
        type: 'github_pr',
        timestamp: pr.createdAt,
        message: `GitHub PR #${pr.prNumber} ${String(pr.status).toLowerCase()}`,
        data: { title: pr.title, url: pr.prUrl, verified: pr.verified },
      })),
      ...(incident.resolvedAt
        ? [{ type: 'resolved', timestamp: incident.resolvedAt, message: 'Incident resolved' }]
        : []),
    ].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    return reply.send({ incidentId: id, timeline });
  });

  app.post('/incidents/:id/diagnose', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { id } = (request.params ?? {}) as { id: string };
    const incident = await prisma.incident.findUnique({
      where: { id, integration: { tenantId } },
      include: {
        invariant: true,
        integration: { select: { id: true, name: true, type: true, tenantId: true, config: true } },
      },
    });
    if (!incident) return reply.code(404).send({ error: 'Incident not found' });

    const { diagnoseIncident } = await import('../services/diagnosis.js');
    const diagnosis = await diagnoseIncident(incident);

    const updated = await prisma.incident.update({
      where: { id },
      data: {
        status: IncidentStatus.TRIAGED,
        rootCause: diagnosis.rootCause,
        suggestedFix: diagnosis.suggestedFix,
        triagedAt: new Date(),
      },
    });

    const { generateRepairCandidates } = await import('../services/repair.js');
    const candidates = await generateRepairCandidates(incident, diagnosis);

    const persistedCandidates = await Promise.all(candidates.map(candidate =>
      prisma.repairCandidate.create({
        data: {
          incidentId: id,
          type: candidate.type as RepairType,
          description: candidate.description,
          diff: candidate.diff,
          files: candidate.files,
          ...(candidate.changes ? { changes: candidate.changes as Prisma.InputJsonValue } : {}),
          confidence: candidate.confidence,
        },
      }),
    ));

    return reply.send({ incident: updated, diagnosis, candidates: persistedCandidates });
  });

  app.post('/incidents/:id/replay', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { id } = (request.params ?? {}) as { id: string };
    const parsed = replaySchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid replay payload', details: parsed.error.flatten() });
    const { webhookEventId, fixCandidate } = parsed.data;

    const incident = await prisma.incident.findFirst({ where: { id, integration: { tenantId } } });
    if (!incident) return reply.code(404).send({ error: 'Incident not found' });

    const webhookEvent = await prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
    if (!webhookEvent) return reply.code(404).send({ error: 'Webhook event not found' });
    if (webhookEvent.integrationId !== incident.integrationId) {
      return reply.code(400).send({ error: 'Webhook event does not belong to this incident integration' });
    }

    const replayJob = await prisma.replayJob.create({
      data: { incidentId: id, webhookEventId, fixCandidate, status: ReplayJobStatus.PENDING },
    });

    processReplayJob(replayJob.id).catch(err => {
      console.error('Replay job failed:', err);
    });

    await prisma.incident.update({
      where: { id },
      data: { status: IncidentStatus.REPLAYING },
    });

    return reply.code(201).send(replayJob);
  });
}

async function processReplayJob(replayJobId: string) {
  const job = await prisma.replayJob.findUnique({
    where: { id: replayJobId },
    include: { incident: { include: { invariant: true } }, webhookEvent: true },
  });
  if (!job) return;

  await prisma.replayJob.update({
    where: { id: replayJobId },
    data: { status: ReplayJobStatus.RUNNING, startedAt: new Date() },
  });

  try {
    const { replayEvent } = await import('../services/replay.js');
    const result = await replayEvent(job.webhookEvent, job.fixCandidate, job.incident.invariant);

    await prisma.replayJob.update({
      where: { id: replayJobId },
      data: {
        status: ReplayJobStatus.COMPLETED,
        result: result.passed ? ReplayJobResult.PASSED : ReplayJobResult.FAILED,
        replayEvaluation: result.evaluation as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });

    if (result.passed) {
      await prisma.repairCandidate.updateMany({
        where: {
          incidentId: job.incidentId,
          OR: [{ diff: job.fixCandidate }, { description: job.fixCandidate }],
        },
        data: { verified: true },
      });
    }
  } catch (error) {
    await prisma.replayJob.update({
      where: { id: replayJobId },
      data: {
        status: ReplayJobStatus.FAILED,
        result: ReplayJobResult.ERROR,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        completedAt: new Date(),
      },
    });
  }
}
