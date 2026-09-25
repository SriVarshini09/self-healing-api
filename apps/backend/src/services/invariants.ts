import { prisma } from '../utils/prisma.js';
import { InvariantStatus } from '@prisma/client';
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

async function openViolationIncident(invariantId: string) {
  const invariant = await prisma.invariant.findUnique({ where: { id: invariantId } });
  if (!invariant) return;

  // Dedupe: one open incident per invariant at a time.
  const existing = await prisma.incident.findFirst({
    where: {
      invariantId,
      status: { in: ['DETECTED', 'TRIAGED', 'REPLAYING'] as any },
    },
  });
  if (existing) return;

  await prisma.incident.create({
    data: {
      integrationId: invariant.integrationId,
      invariantId,
      title: `Invariant violated: ${invariant.name}`,
      description: `Behavioral invariant "${invariant.name}" failed: ${invariant.predicateDescription}`,
      severity: 'HIGH' as any,
      status: 'DETECTED' as any,
    },
  });
  logger.info({ invariantId }, 'Opened violation incident');
}
