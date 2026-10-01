import type { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { GitHubPRStatus, InvariantStatus, Prisma } from '@prisma/client';
import {
  validatePredicate as sandboxValidate,
} from '@shapi/invariant-engine';
import { validateRepairChanges } from '@shapi/repair-generation';
import { evaluateInvariantWindow } from '../services/invariants.js';
import { tenantIdFor } from '../utils/auth-context.js';
import { config } from '../config.js';

export async function invariantRoutes(app: FastifyInstance) {
  app.get('/invariants', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const q = (request.query ?? {}) as Record<string, unknown>;
    const page = Number(q.page ?? 1) || 1;
    const pageSize = Math.min(Number(q.pageSize ?? 20) || 20, 100);

    const where: Prisma.InvariantWhereInput = { integration: { tenantId } };
    if (typeof q.integrationId === 'string') where.integrationId = q.integrationId;
    if (typeof q.status === 'string' && (Object.values(InvariantStatus) as string[]).includes(q.status)) {
      where.status = q.status as InvariantStatus;
    }

    const [invariants, total] = await Promise.all([
      prisma.invariant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          integration: { select: { id: true, name: true, type: true } },
        },
      }),
      prisma.invariant.count({ where }),
    ]);

    return reply.send({
      data: invariants,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  });

  app.get('/invariants/:id', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { id } = (request.params ?? {}) as { id: string };
    const invariant = await prisma.invariant.findUnique({
      where: { id, integration: { tenantId } },
      include: {
        integration: { select: { id: true, name: true, type: true, webhookEnabled: true } },
        evaluations: { orderBy: { windowStart: 'desc' }, take: 50 },
        incidents: { orderBy: { detectedAt: 'desc' }, take: 10 },
        driftResults: { orderBy: { detectedAt: 'desc' }, take: 20 },
      },
    });
    if (!invariant) return reply.code(404).send({ error: 'Invariant not found' });
    return reply.send(invariant);
  });

  app.post('/invariants', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const data = (request.body ?? {}) as {
      integrationId: string;
      name: string;
      description?: string;
      predicateExpression: string;
      predicateDescription: string;
      predicateExample?: string;
      repairRepository?: string | null;
      repairFilePath?: string | null;
      repairRequiredChecks?: string[];
      evaluationWindowSec?: number;
      minSamples?: number;
      expectedSuccessRate?: number;
    };

    if (!data.integrationId || !data.name || !data.predicateExpression) {
      return reply.code(400).send({ error: 'integrationId, name, predicateExpression required' });
    }

    try {
      validatePredicateExpression(data.predicateExpression);
    } catch (error) {
      return reply.code(400).send({
        error: 'Invalid predicate expression',
        details: error instanceof Error ? error.message : String(error),
      });
    }
    const targetError = repairTargetError(data.repairRepository ?? null, data.repairFilePath ?? null);
    if (targetError) return reply.code(400).send({ error: 'Invalid repair target', details: targetError });
    const requiredChecksError = repairRequiredChecksError(data.repairRequiredChecks);
    if (requiredChecksError) return reply.code(400).send({ error: 'Invalid required checks', details: requiredChecksError });
    const normalizedRequiredChecks = normalizeRepairRequiredChecks(data.repairRequiredChecks);
    if (data.repairRepository && data.repairFilePath && normalizedRequiredChecks.length === 0) {
      return reply.code(400).send({
        error: 'Invalid repair target checks',
        details: 'mapped repair targets must declare at least one required GitHub check',
      });
    }

    const result = await prisma.$transaction(async tx => {
      // Serialize creates for this tenant across backend processes so the
      // count and insert cannot both succeed at the quota boundary.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}, 0))::text`;
      const integration = await tx.integration.findFirst({ where: { id: data.integrationId, tenantId } });
      if (!integration) return { kind: 'missing' } as const;
      const count = await tx.invariant.count({ where: { integration: { tenantId } } });
      if (count >= config.SHAPI_MAX_INVARIANTS_PER_TENANT) return { kind: 'quota' } as const;
      const invariant = await tx.invariant.create({
        data: {
          integrationId: data.integrationId,
          name: data.name,
          description: data.description ?? '',
          predicateExpression: data.predicateExpression,
          predicateDescription: data.predicateDescription ?? '',
          predicateExample: data.predicateExample,
          repairRepository: data.repairRepository ?? null,
          repairFilePath: data.repairFilePath ?? null,
          repairRequiredChecks: normalizedRequiredChecks,
          evaluationWindowSec: data.evaluationWindowSec ?? 300,
          minSamples: data.minSamples ?? 10,
          expectedSuccessRate: data.expectedSuccessRate ?? 0.99,
          status: InvariantStatus.UNKNOWN,
        },
      });
      return { kind: 'created', invariant } as const;
    });
    if (result.kind === 'missing') return reply.code(404).send({ error: 'Integration not found' });
    if (result.kind === 'quota') return reply.code(409).send({
      error: 'Invariant quota reached for this tenant',
      limit: config.SHAPI_MAX_INVARIANTS_PER_TENANT,
    });
    return reply.code(201).send(result.invariant);
  });

  app.patch('/invariants/:id', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { id } = (request.params ?? {}) as { id: string };
    const data = (request.body ?? {}) as Partial<{
      name: string;
      description: string;
      predicateExpression: string;
      predicateDescription: string;
      predicateExample: string;
      repairRepository: string | null;
      repairFilePath: string | null;
      repairRequiredChecks: string[];
      evaluationWindowSec: number;
      minSamples: number;
      expectedSuccessRate: number;
    }>;

    const existing = await prisma.invariant.findFirst({ where: { id, integration: { tenantId } } });
    if (!existing) return reply.code(404).send({ error: 'Invariant not found' });
    const targetError = repairTargetError(
      data.repairRepository === undefined ? existing.repairRepository : data.repairRepository,
      data.repairFilePath === undefined ? existing.repairFilePath : data.repairFilePath,
    );
    if (targetError) return reply.code(400).send({ error: 'Invalid repair target', details: targetError });
    const requestedChecks = data.repairRequiredChecks === undefined
      ? existing.repairRequiredChecks
      : data.repairRequiredChecks;
    const requiredChecksError = repairRequiredChecksError(requestedChecks);
    if (requiredChecksError) return reply.code(400).send({ error: 'Invalid required checks', details: requiredChecksError });
    const normalizedRequestedChecks = normalizeRepairRequiredChecks(requestedChecks);
    const requestedRepository = data.repairRepository === undefined ? existing.repairRepository : data.repairRepository;
    const requestedFilePath = data.repairFilePath === undefined ? existing.repairFilePath : data.repairFilePath;
    if (requestedRepository && requestedFilePath && normalizedRequestedChecks.length === 0) {
      return reply.code(400).send({
        error: 'Invalid repair target checks',
        details: 'mapped repair targets must declare at least one required GitHub check',
      });
    }

    if (data.predicateExpression) {
      try {
        validatePredicateExpression(data.predicateExpression);
      } catch (error) {
        return reply.code(400).send({
          error: 'Invalid predicate expression',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const repairConfigurationChanged =
      (data.predicateExpression !== undefined && data.predicateExpression !== existing.predicateExpression) ||
      requestedRepository !== existing.repairRepository ||
      requestedFilePath !== existing.repairFilePath ||
      JSON.stringify(normalizedRequestedChecks) !== JSON.stringify(existing.repairRequiredChecks);

    const invariant = await prisma.invariant.update({
      where: { id },
      data: data.repairRequiredChecks === undefined
        ? data
        : { ...data, repairRequiredChecks: normalizeRepairRequiredChecks(data.repairRequiredChecks) },
    });

    if (repairConfigurationChanged) {
      // A green check result only proves the exact repair configuration that
      // was reviewed. Keep historical merged/closed PR evidence intact, but
      // fail closed for actionable PRs after their target or required checks
      // change so the dashboard cannot present stale verification.
      await prisma.gitHubPullRequest.updateMany({
        where: {
          incident: { invariantId: id },
          status: { in: [GitHubPRStatus.OPEN, GitHubPRStatus.DRAFT] },
        },
        data: { verified: false, verifiedAt: null, verificationHeadSha: null, verificationChecks: Prisma.DbNull },
      });
    }
    return reply.send(invariant);
  });

  app.delete('/invariants/:id', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { id } = (request.params ?? {}) as { id: string };
    const existing = await prisma.invariant.findFirst({ where: { id, integration: { tenantId } } });
    if (!existing) return reply.code(404).send({ error: 'Invariant not found' });
    await prisma.invariant.delete({ where: { id } });
    return reply.code(204).send();
  });

  app.post('/invariants/:id/evaluate', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { id } = (request.params ?? {}) as { id: string };
    const body = (request.body ?? {}) as { windowStart?: string; windowEnd?: string };

    const invariant = await prisma.invariant.findFirst({ where: { id, integration: { tenantId } } });
    if (!invariant) return reply.code(404).send({ error: 'Invariant not found' });

    const start = body.windowStart
      ? new Date(body.windowStart)
      : new Date(Date.now() - invariant.evaluationWindowSec * 1000);
    const end = body.windowEnd ? new Date(body.windowEnd) : new Date();

    const evaluation = await evaluateInvariantWindow(invariant, start, end);
    return reply.send(evaluation);
  });

  app.get('/invariants/:id/evaluations', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { id } = (request.params ?? {}) as { id: string };
    const q = (request.query ?? {}) as Record<string, unknown>;
    const page = Number(q.page ?? 1) || 1;
    const pageSize = Math.min(Number(q.pageSize ?? 20) || 20, 100);

    const [evaluations, total] = await Promise.all([
      prisma.invariantEvaluation.findMany({
        where: { invariantId: id, invariant: { integration: { tenantId } } },
        orderBy: { windowStart: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.invariantEvaluation.count({ where: { invariantId: id, invariant: { integration: { tenantId } } } }),
    ]);

    return reply.send({
      data: evaluations,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  });
}

export function validatePredicateExpression(expression: string): void {
  // Delegates to @shapi/invariant-engine: dangerous-pattern rejection + vm-based syntax check.
  sandboxValidate(expression);
}

export function repairTargetError(repository: unknown, filePath: unknown): string | null {
  if (repository == null && filePath == null) return null;
  if (typeof repository !== 'string' || typeof filePath !== 'string') {
    return 'repairRepository and repairFilePath must be set or cleared together';
  }
  const parts = repository.split('/');
  if (repository.length > 200 || parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_.-]+$/.test(part) || part === '.' || part === '..')) {
    return 'repairRepository must be an owner/repository name';
  }
  if (filePath.length > 400) return 'repairFilePath is too long';
  try {
    validateRepairChanges([{ kind: 'create', path: filePath, content: '' }]);
  } catch (error) {
    return error instanceof Error ? error.message : 'invalid repairFilePath';
  }
  return null;
}

function normalizeRepairRequiredChecks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((check): check is string => typeof check === 'string').map(check => check.trim()).filter(Boolean))];
}

export function repairRequiredChecksError(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) return 'repairRequiredChecks must be an array of check names';
  if (value.length > 20) return 'repairRequiredChecks cannot contain more than 20 checks';
  if (value.some(check => typeof check !== 'string' || check.trim().length === 0 || check.trim().length > 200)) {
    return 'each required check name must be a non-empty string of at most 200 characters';
  }
  if (normalizeRepairRequiredChecks(value).length !== value.length) return 'repairRequiredChecks must not contain duplicate names';
  return null;
}
