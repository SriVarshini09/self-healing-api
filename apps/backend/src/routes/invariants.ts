import type { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma.js';
import type { Prisma } from '@prisma/client';
import { InvariantStatus } from '@prisma/client';
import {
  validatePredicate as sandboxValidate,
} from '@shapi/invariant-engine';
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
      evaluationWindowSec: number;
      minSamples: number;
      expectedSuccessRate: number;
    }>;

    const existing = await prisma.invariant.findFirst({ where: { id, integration: { tenantId } } });
    if (!existing) return reply.code(404).send({ error: 'Invariant not found' });

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

    const invariant = await prisma.invariant.update({ where: { id }, data });
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
