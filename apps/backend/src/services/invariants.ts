import { prisma } from '../utils/prisma.js';
import { IncidentSeverity, IncidentStatus, InvariantStatus, WebhookEventStatus, type Invariant, type Prisma } from '@prisma/client';
import {
  evaluatePredicate as sandboxedEvaluate,
  isRelevantEvent,
  type InvariantEvent,
} from '@shapi/invariant-engine';
import { logger } from '../utils/logger.js';

export interface InvariantEventContext {
  type: string;
  payload: Record<string, unknown>;
  headers: Record<string, unknown>;
}

export function evaluatePredicate(expression: string, context: { event: InvariantEventContext }): boolean {
  return sandboxedEvaluate(expression, context.event as InvariantEvent).passed;
}

/**
 * Evaluate every invariant of an integration that scopes to this event type,
 * flip statuses, and open a (deduped) incident on violation. Used by both the
 * webhook pipeline and the SDK-track pipeline so behavioral failures surface
 * no matter which channel reports them.
 *
 * VIOLATED invariants stay in the evaluation set so recovery (back to HEALTHY)
 * and re-offense (new incident after resolve) both work.
 *
 * Returns the ids of invariants that were actually evaluated.
 */
export async function evaluateInvariantsForEvent(
  integrationId: string,
  eventType: string,
  payload: Record<string, unknown>,
  headers: Record<string, unknown> = {},
): Promise<string[]> {
  const invariants = await prisma.invariant.findMany({ where: { integrationId } });
  const evaluated: string[] = [];

  for (const invariant of invariants) {
    if (!isRelevantEvent(invariant.predicateExpression, eventType)) continue;
    evaluated.push(invariant.id);

    let passed = false;
    try {
      passed = sandboxedEvaluate(invariant.predicateExpression, {
        type: eventType,
        payload,
        headers,
      } as InvariantEvent).passed;
    } catch (error) {
      logger.error({ invariantId: invariant.id, error }, 'Failed to evaluate invariant');
    }

    await prisma.invariant.update({
      where: { id: invariant.id },
      data: {
        lastEvaluatedAt: new Date(),
        status: passed ? InvariantStatus.HEALTHY : InvariantStatus.VIOLATED,
      },
    });

    if (!passed) await openViolationIncident(invariant.id);
  }

  return evaluated;
}

export async function evaluateInvariantWindow(
  invariant: Invariant,
  windowStart: Date,
  windowEnd: Date,
) {
  const integration = await prisma.integration.findUnique({
    where: { id: invariant.integrationId },
    select: { type: true, tenantId: true },
  });
  if (!integration) return null;

  const webhookEvents = await prisma.webhookEvent.findMany({
      where: {
        integrationId: invariant.integrationId,
        receivedAt: { gte: windowStart, lte: windowEnd },
        status: WebhookEventStatus.COMPLETED,
      },
  });
  const trackedEvents = await prisma.trackedEvent.findMany({
    where: {
      tenantId: integration.tenantId,
      integration: integration.type,
      timestamp: { gte: windowStart, lte: windowEnd },
    },
  });

  let passedSamples = 0;
  let totalSamples = 0;
  for (const event of webhookEvents) {
    if (!isRelevantEvent(invariant.predicateExpression, event.eventType)) continue;
    totalSamples++;
    if (sandboxedEvaluate(invariant.predicateExpression, {
      type: event.eventType,
      payload: (event.payload ?? {}) as Record<string, unknown>,
      headers: (event.headers ?? {}) as Record<string, unknown>,
    } as InvariantEvent).passed) {
      passedSamples++;
    }
  }

  for (const event of trackedEvents) {
    if (!isRelevantEvent(invariant.predicateExpression, event.type)) continue;
    totalSamples++;
    if (sandboxedEvaluate(invariant.predicateExpression, {
      type: event.type,
      payload: (event.payload ?? {}) as Record<string, unknown>,
      headers: {},
    } as InvariantEvent).passed) {
      passedSamples++;
    }
  }

  const successRate = totalSamples === 0 ? 1 : passedSamples / totalSamples;
  const status = determineInvariantStatus(
    successRate,
    invariant.expectedSuccessRate,
    totalSamples,
    invariant.minSamples,
  );

  const evaluation = await prisma.invariantEvaluation.upsert({
    where: { invariantId_windowStart_windowEnd: { invariantId: invariant.id, windowStart, windowEnd } },
    update: { totalSamples, passedSamples, successRate, status, details: {} as Prisma.InputJsonValue },
    create: {
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

async function openViolationIncident(invariantId: string) {
  const invariant = await prisma.invariant.findUnique({ where: { id: invariantId } });
  if (!invariant) return;

  // Dedupe: one open incident per invariant at a time.
  const existing = await prisma.incident.findFirst({
    where: {
      invariantId,
      status: { in: [IncidentStatus.DETECTED, IncidentStatus.TRIAGED, IncidentStatus.REPLAYING] },
    },
  });
  if (existing) return;

  await prisma.incident.create({
    data: {
      integrationId: invariant.integrationId,
      invariantId,
      title: `Invariant violated: ${invariant.name}`,
      description: `Behavioral invariant "${invariant.name}" failed: ${invariant.predicateDescription}`,
      severity: IncidentSeverity.HIGH,
      status: IncidentStatus.DETECTED,
    },
  });
  logger.info({ invariantId }, 'Opened violation incident');
}
