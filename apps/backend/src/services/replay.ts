import { prisma } from '../utils/prisma.js';
import { WebhookEventStatus, type Invariant, type WebhookEvent } from '@prisma/client';
import { evaluatePredicate as sandboxedEvaluate } from '@shapi/invariant-engine';

export interface ReplayResult {
  passed: boolean;
  evaluation: {
    totalSamples: number;
    passedSamples: number;
    successRate: number;
    details: Record<string, unknown>;
  };
}

export async function replayEvent(
  webhookEvent: WebhookEvent,
  fixCandidate: string,
  invariant: Invariant | null,
): Promise<ReplayResult> {
  if (!invariant) {
    throw new Error('No invariant associated with replay');
  }

  const modifiedContext = applyFixCandidate(webhookEvent, fixCandidate);
  const passed = evaluatePredicate(invariant.predicateExpression, modifiedContext);

  return {
    passed,
    evaluation: {
      totalSamples: 1,
      passedSamples: passed ? 1 : 0,
      successRate: passed ? 1 : 0,
      details: {
        originalEventType: webhookEvent.eventType,
        fixCandidate,
        predicateResult: passed,
        modifiedPayload: modifiedContext.event.payload,
      },
    },
  };
}

function applyFixCandidate(
  webhookEvent: WebhookEvent,
  fixCandidate: string,
): { event: { type: string; payload: Record<string, unknown>; headers: Record<string, unknown> } } {
  const payload = { ...((webhookEvent.payload ?? {}) as Record<string, unknown>) };
  const headers = { ...((webhookEvent.headers ?? {}) as Record<string, unknown>) };

  try {
    if (fixCandidate.includes('add_field:')) {
      const parts = fixCandidate.split(':');
      if (parts.length >= 3) {
        payload[parts[1]] = parseValue(parts.slice(2).join(':'));
      }
    } else if (fixCandidate.includes('modify_field:')) {
      const parts = fixCandidate.split(':');
      if (parts.length >= 3) {
        payload[parts[1]] = parseValue(parts.slice(2).join(':'));
      }
    } else if (fixCandidate.includes('remove_field:')) {
      delete payload[fixCandidate.split(':')[1]];
    }
  } catch (error) {
    console.warn('Failed to apply fix candidate:', error);
  }

  return { event: { type: webhookEvent.eventType, payload, headers } };
}

function parseValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function evaluatePredicate(
  expression: string,
  context: { event: { type: string; payload: Record<string, unknown>; headers: Record<string, unknown> } },
): boolean {
  // Sandboxed evaluation shared with @shapi/invariant-engine (node:vm, 100ms timeout).
  return sandboxedEvaluate(expression, context.event).passed;
}

export async function batchReplay(
  invariantId: string,
  fixCandidate: string,
  limit = 50,
): Promise<ReplayResult[]> {
  const invariant = await prisma.invariant.findUnique({ where: { id: invariantId } });
  if (!invariant) throw new Error('Invariant not found');

  const events = await prisma.webhookEvent.findMany({
    where: { integrationId: invariant.integrationId, status: WebhookEventStatus.COMPLETED },
    orderBy: { receivedAt: 'desc' },
    take: limit,
  });

  const results: ReplayResult[] = [];
  for (const event of events) {
    results.push(await replayEvent(event, fixCandidate, invariant));
  }
  return results;
}

export async function verifyFix(
  invariantId: string,
  fixCandidate: string,
  requiredPassRate = 0.95,
): Promise<{ verified: boolean; passRate: number; results: ReplayResult[] }> {
  const results = await batchReplay(invariantId, fixCandidate, 100);
  const passed = results.filter(r => r.passed).length;
  const passRate = results.length > 0 ? passed / results.length : 0;
  return { verified: passRate >= requiredPassRate, passRate, results };
}
