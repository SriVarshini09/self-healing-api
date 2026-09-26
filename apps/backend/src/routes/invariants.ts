import type { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma.js';
import type { Prisma} from '@prisma/client';
import { InvariantStatus, WebhookEventStatus, type Invariant } from '@prisma/client';
import {
  evaluatePredicate as sandboxedEvaluate,
  validatePredicate as sandboxValidate,
  isRelevantEvent,
} from '@shapi/invariant-engine';

export async function invariantRoutes(app: FastifyInstance) {
  app.get('/invariants', async (request, reply) => {
    const q = (request.query ?? {}) as Record<string, unknown>;
    const page = Number(q.page ?? 1) || 1;
    const pageSize = Math.min(Number(q.pageSize ?? 20) || 20, 100);

    const where: Prisma.InvariantWhereInput = {};
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
    const { id } = (request.params ?? {}) as { id: string };
    const invariant = await prisma.invariant.findUnique({
      where: { id },
      include: {
        integration: true,
        evaluations: { orderBy: { windowStart: 'desc' }, take: 50 },
        incidents: { orderBy: { detectedAt: 'desc' }, take: 10 },
        driftResults: { orderBy: { detectedAt: 'desc' }, take: 20 },
      },
    });
    if (!invariant) return reply.code(404).send({ error: 'Invariant not found' });
    return reply.send(invariant);
  });

  app.post('/invariants', async (request, reply) => {
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

    const invariant = await prisma.invariant.create({
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
    return reply.code(201).send(invariant);
  });

  app.patch('/invariants/:id', async (request, reply) => {
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
    const { id } = (request.params ?? {}) as { id: string };
    await prisma.invariant.delete({ where: { id } });
    return reply.code(204).send();
  });

  app.post('/invariants/:id/evaluate', async (request, reply) => {
    const { id } = (request.params ?? {}) as { id: string };
    const body = (request.body ?? {}) as { windowStart?: string; windowEnd?: string };

    const invariant = await prisma.invariant.findUnique({ where: { id } });
    if (!invariant) return reply.code(404).send({ error: 'Invariant not found' });

    const start = body.windowStart
      ? new Date(body.windowStart)
      : new Date(Date.now() - invariant.evaluationWindowSec * 1000);
    const end = body.windowEnd ? new Date(body.windowEnd) : new Date();

    const evaluation = await evaluateInvariantWindow(invariant, start, end);
    return reply.send(evaluation);
  });

  app.get('/invariants/:id/evaluations', async (request, reply) => {
    const { id } = (request.params ?? {}) as { id: string };
    const q = (request.query ?? {}) as Record<string, unknown>;
    const page = Number(q.page ?? 1) || 1;
    const pageSize = Math.min(Number(q.pageSize ?? 20) || 20, 100);

    const [evaluations, total] = await Promise.all([
      prisma.invariantEvaluation.findMany({
        where: { invariantId: id },
        orderBy: { windowStart: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.invariantEvaluation.count({ where: { invariantId: id } }),
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

async function evaluateInvariantWindow(
  invariant: Invariant,
  windowStart: Date,
  windowEnd: Date,
) {
  const events = (
    await prisma.webhookEvent.findMany({
      where: {
        integrationId: invariant.integrationId,
        receivedAt: { gte: windowStart, lte: windowEnd },
        status: WebhookEventStatus.COMPLETED,
      },
    })
    // Only events the predicate scopes to count as samples.
  ).filter(e => isRelevantEvent(invariant.predicateExpression, e.eventType));

  let passedSamples = 0;
  for (const event of events) {
    try {
      const passed = evaluatePredicate(invariant.predicateExpression, {
        event: {
          type: event.eventType,
          payload: (event.payload ?? {}) as Record<string, unknown>,
          headers: (event.headers ?? {}) as Record<string, unknown>,
        },
      });
      if (passed) passedSamples++;
    } catch {
      // count as failure
    }
  }

  const totalSamples = events.length;
  const successRate = totalSamples > 0 ? passedSamples / totalSamples : 1;
  const status = determineInvariantStatus(
    successRate,
    invariant.expectedSuccessRate,
    totalSamples,
    invariant.minSamples,
  );

  const evaluation = await prisma.invariantEvaluation.create({
    data: {
      invariantId: invariant.id,
      windowStart,
      windowEnd,
      totalSamples,
      passedSamples,
      successRate,
      status,
      details: {} as Prisma.InputJsonValue,
    },
  });

  await prisma.invariant.update({
    where: { id: invariant.id },
    data: { status, lastEvaluatedAt: new Date() },
  });

  return evaluation;
}

function evaluatePredicate(
  expression: string,
  context: { event: { type: string; payload: Record<string, unknown>; headers: Record<string, unknown> } },
): boolean {
  // Sandboxed evaluation shared with @shapi/invariant-engine (node:vm, 100ms timeout).
  return sandboxedEvaluate(expression, context.event).passed;
}

function determineInvariantStatus(
  successRate: number,
  expectedRate: number,
  totalSamples: number,
  minSamples: number,
): InvariantStatus {
  if (totalSamples < minSamples) return InvariantStatus.UNKNOWN;
  if (successRate >= expectedRate) return InvariantStatus.HEALTHY;
  if (successRate >= expectedRate * 0.9) return InvariantStatus.DEGRADED;
  return InvariantStatus.VIOLATED;
}
