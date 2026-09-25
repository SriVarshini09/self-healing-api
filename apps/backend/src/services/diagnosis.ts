import { prisma } from '../utils/prisma.js';
import type { Incident, Invariant } from '@prisma/client';

export interface DiagnosisResult {
  rootCause: string;
  suggestedFix: string;
  confidence: number;
  evidence: string[];
}

export async function diagnoseIncident(incident: Incident & { invariant: Invariant | null; integration: any }): Promise<DiagnosisResult> {
  const { invariant, integration } = incident;

  if (!invariant) {
    return {
      rootCause: 'No invariant associated with this incident',
      suggestedFix: 'Associate a behavioral invariant with this integration',
      confidence: 0.1,
      evidence: ['Incident has no invariantId']
    };
  }

  // Analyze recent webhook events for patterns
  const recentEvents = await prisma.webhookEvent.findMany({
    where: {
      integrationId: integration.id,
      receivedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      status: { in: ['COMPLETED', 'FAILED'] }
    },
    orderBy: { receivedAt: 'desc' },
    take: 100
  });

  const failedEvents = recentEvents.filter(e => e.status === 'FAILED');
  const totalEvents = recentEvents.length;
  const failureRate = totalEvents > 0 ? failedEvents.length / totalEvents : 0;

  // Analyze invariant evaluations
  const evaluations = await prisma.invariantEvaluation.findMany({
    where: { invariantId: invariant.id },
    orderBy: { windowStart: 'desc' },
    take: 20
  });

  const recentSuccessRate = evaluations.length > 0
    ? evaluations.reduce((sum, e) => sum + e.successRate, 0) / evaluations.length
    : 1;

  // Determine root cause based on patterns
  let rootCause = '';
  let suggestedFix = '';
  let confidence = 0.5;
  const evidence: string[] = [];

  // Pattern 0 (strongest): failed business outcomes tracked by the SDK.
  // HTTP was 200 everywhere — this is exactly the silent failure SHAPI exists for.
  const failedOutcomes = await prisma.trackedEvent.findMany({
    where: {
      integration: integration.type as any,
      timestamp: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      OR: [{ type: { endsWith: '.failed' } }, { type: { endsWith: '_failed' } }],
    },
    orderBy: { timestamp: 'desc' },
    take: 20,
  });

  if (failedOutcomes.length > 0) {
    const latest = failedOutcomes[0];
    const reason = extractOutcomeReason((latest.payload ?? {}) as Record<string, unknown>);
    rootCause =
      `${failedOutcomes.length} failed business outcome(s) tracked in 24h ` +
      `(latest: ${latest.type}${reason ? ` — ${reason}` : ''})`;
    suggestedFix =
      'The HTTP layer succeeded but the business outcome failed. ' +
      'Inspect the provisioning/business-logic path for this integration, not the webhook transport.';
    confidence = 0.9;
    evidence.push(
      `${failedOutcomes.length} tracked failure(s), e.g. ${latest.type} at ${latest.timestamp.toISOString()}`,
      ...(latest.correlationId ? [`correlationId: ${latest.correlationId}`] : []),
      ...(reason ? [`reason: ${reason}`] : []),
    );
    return finish(integration, { rootCause, suggestedFix, confidence, evidence });
  }

  // Pattern 1: High webhook failure rate
  if (failureRate > 0.1) {
    rootCause = `High webhook failure rate (${(failureRate * 100).toFixed(1)}%)`;
    suggestedFix = 'Check webhook endpoint availability and retry logic. Verify third-party service status.';
    confidence = 0.8;
    evidence.push(`${failedEvents.length}/${totalEvents} webhooks failed in last 24h`);
  }

  // Pattern 2: Invariant success rate dropped significantly
  else if (recentSuccessRate < invariant.expectedSuccessRate * 0.8) {
    const drop = ((invariant.expectedSuccessRate - recentSuccessRate) * 100).toFixed(1);
    rootCause = `Invariant success rate dropped ${drop}% below expected (${(recentSuccessRate * 100).toFixed(1)}% vs ${(invariant.expectedSuccessRate * 100).toFixed(1)}%)`;
    suggestedFix = `Review predicate logic: "${invariant.predicateDescription}". Check if third-party API behavior changed.`;
    confidence = 0.85;
    evidence.push(`Expected: ${(invariant.expectedSuccessRate * 100).toFixed(1)}%, Actual: ${(recentSuccessRate * 100).toFixed(1)}%`);
  }

  // Pattern 3: Specific event type failures
  else if (failedEvents.length > 0) {
    const eventTypes = failedEvents.reduce((acc, e) => {
      acc[e.eventType] = (acc[e.eventType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const topFailedType = Object.entries(eventTypes).sort((a, b) => b[1] - a[1])[0];
    rootCause = `Failures concentrated in event type: ${topFailedType[0]} (${topFailedType[1]} failures)`;
    suggestedFix = `Investigate ${topFailedType[0]} event handling. Check payload structure and predicate matching.`;
    confidence = 0.7;
    evidence.push(`Event type distribution: ${JSON.stringify(eventTypes)}`);
  }

  // Pattern 4: Drift detection triggered
  else {
    const driftResult = await prisma.driftResult.findFirst({
      where: { invariantId: invariant.id, detected: true },
      orderBy: { detectedAt: 'desc' }
    });

    if (driftResult) {
      rootCause = `Statistical drift detected: success rate changed from ${(driftResult.baselineRate * 100).toFixed(1)}% to ${(driftResult.currentRate * 100).toFixed(1)}% (p=${driftResult.pValue.toFixed(4)})`;
      suggestedFix = 'Review recent changes to integration configuration or third-party API. Consider updating invariant predicate.';
      confidence = 0.9;
      evidence.push(`Drift detected at ${driftResult.detectedAt.toISOString()}`);
    } else {
      rootCause = 'Invariant violation detected without clear pattern';
      suggestedFix = 'Manually review recent webhook events and invariant predicate. Add more specific invariants if needed.';
      confidence = 0.4;
      evidence.push('No clear automated diagnosis pattern matched');
    }
  }

  return finish(integration, { rootCause, suggestedFix, confidence, evidence });
}

function finish(
  integration: { type: string },
  diagnosis: { rootCause: string; suggestedFix: string; confidence: number; evidence: string[] },
) {
  // Add integration-specific suggestions
  if (integration.type === 'STRIPE') {
    diagnosis.suggestedFix += ' Check Stripe Dashboard for API changes or webhook delivery issues.';
  } else if (integration.type === 'GITHUB') {
    diagnosis.suggestedFix += ' Verify GitHub App permissions and webhook configuration.';
  }
  return diagnosis;
}

function extractOutcomeReason(payload: Record<string, unknown>): string | null {
  const candidates = [
    (payload.outcome as Record<string, unknown> | undefined)?.reason,
    payload.error,
    payload.reason,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim().slice(0, 140);
  }
  return null;
}

export async function generateHypotheses(incident: Incident & { invariant: Invariant | null }): Promise<string[]> {
  const hypotheses: string[] = [];

  if (!incident.invariant) return hypotheses;

  const invariant = incident.invariant;

  // Hypothesis 1: Third-party API changed
  hypotheses.push('Third-party API response format changed, causing predicate mismatch');

  // Hypothesis 2: Network/timeout issues
  hypotheses.push('Intermittent network issues causing webhook delivery failures');

  // Hypothesis 3: Predicate too strict
  hypotheses.push(`Invariant predicate "${invariant.predicateDescription}" may be too strict for current data patterns`);

  // Hypothesis 4: Missing event types
  hypotheses.push('New event types from third-party not covered by existing invariants');

  // Hypothesis 5: Race condition
  hypotheses.push('Race condition between webhook processing and invariant evaluation');

  return hypotheses;
}