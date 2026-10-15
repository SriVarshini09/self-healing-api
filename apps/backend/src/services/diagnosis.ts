import { prisma } from '../utils/prisma.js';
import type { Incident, IntegrationType, Invariant } from '@prisma/client';

export interface DiagnosisResult {
  rootCause: string;
  suggestedFix: string;
  confidence: number;
  evidence: string[];
}

type DiagnosisIntegration = { id: string; type: IntegrationType; tenantId: string | null };

export async function diagnoseIncident(incident: Incident & { invariant: Invariant | null; integration: DiagnosisIntegration }): Promise<DiagnosisResult> {
  const { invariant, integration } = incident;

  // Specific, evidence-based diagnoses first: outcome checks and Stripe changes
  // know exactly which customers and fields are involved.
  if (invariant?.id.startsWith(OUTCOME_PREFIX)) {
    const specific = await diagnoseOutcomeCheck(incident, invariant.id.slice(OUTCOME_PREFIX.length));
    if (specific) return specific;
  }
  if (!invariant) {
    const specific = await diagnoseStripeChanges(incident);
    if (specific) return specific;
  }

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
      tenantId: integration.tenantId,
      integration: integration.type as IntegrationType,
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
      'Inspect the business-logic path for this integration, not the webhook transport.';
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

const OUTCOME_PREFIX = 'outcome-';
const DAY_MS = 24 * 60 * 60 * 1000;

function bindingSummary(params: unknown): string {
  const values = (params ?? {}) as Record<string, unknown>;
  if (typeof values.customer === 'string') return `customer ${values.customer}`;
  const entries = Object.entries(values).slice(0, 3).map(([key, value]) => `${key}=${String(value)}`);
  return entries.length ? entries.join(', ') : 'no bound values';
}

/** Which payments failed the check, and whether a Stripe change explains it. */
async function diagnoseOutcomeCheck(incident: Incident, checkId: string): Promise<DiagnosisResult | null> {
  const check = await prisma.outcomeCheck.findUnique({ where: { id: checkId } });
  if (!check) return null;
  const since = new Date(incident.detectedAt.getTime() - DAY_MS);
  const [failed, failedCount, passedCount, changes] = await Promise.all([
    prisma.outcomeCheckRun.findMany({
      where: { checkId, status: 'FAILED', createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.outcomeCheckRun.count({ where: { checkId, status: 'FAILED', createdAt: { gte: since } } }),
    prisma.outcomeCheckRun.count({ where: { checkId, status: 'PASSED', createdAt: { gte: since } } }),
    prisma.stripeChange.findMany({
      where: { integrationId: check.integrationId, affectedCheckIds: { has: checkId }, detectedAt: { gte: new Date(incident.detectedAt.getTime() - 7 * DAY_MS) } },
      orderBy: { detectedAt: 'desc' },
      take: 3,
    }),
  ]);
  if (!failedCount) return null;

  const evidence = failed.map(run => `${bindingSummary(run.params)} · ${run.sourceEventId}${run.detail ? ` · ${run.detail}` : ''}`);
  const total = failedCount + passedCount;
  let rootCause = `${failedCount} of ${total} ${check.triggerEventType} event(s) since the day before this incident had no matching row in your database (latest: ${failed[0] ? bindingSummary(failed[0].params) : 'unknown'}).`;
  let confidence = 0.85;
  if (changes.length) {
    const change = changes[0];
    rootCause += ` Stripe changed ${change.path ?? `its API version to ${change.after}`} on ${change.detectedAt.toISOString().slice(0, 10)}, and this check reads it: your webhook handler probably reads the old field too.`;
    confidence = 0.9;
    evidence.push(...changes.map(item => `Stripe change: ${item.kind} ${item.path ?? ''} ${item.before ?? ''} -> ${item.after ?? 'removed'}`.replace(/\s+/g, ' ').trim()));
  } else if (!passedCount) {
    rootCause += ' None passed, so the handler is failing for everyone, not only some customers.';
  }
  const suggestedFix = [
    `Open your webhook handler for ${check.triggerEventType} and follow it for ${failed[0] ? bindingSummary(failed[0].params) : 'one of these customers'}: it returned 200 but did not write the row the check looks for.`,
    changes.length ? 'Update it to read the field where Stripe now sends it.' : '',
    'After deploying the fix, use Test on the outcome check with one of these events, give the affected customers their access, then resolve this incident.',
  ].filter(Boolean).join(' ');
  return { rootCause, suggestedFix, confidence, evidence };
}

/** Stripe change incidents have no rule; their changes are the diagnosis. */
async function diagnoseStripeChanges(incident: Incident): Promise<DiagnosisResult | null> {
  const changes = await prisma.stripeChange.findMany({ where: { incidentId: incident.id }, orderBy: { detectedAt: 'asc' } });
  if (!changes.length) return null;
  const fields = changes.filter(change => change.path);
  const version = changes.find(change => change.kind === 'API_VERSION');
  const readByChecks = fields.some(change => change.affectedCheckIds.length);
  const rootCause = [
    version ? `Stripe now sends webhooks with API version ${version.after}${version.before ? ` (was ${version.before})` : ''}.` : '',
    fields.length ? `${fields.length} field(s) changed: ${fields.slice(0, 4).map(change => `${change.path} (${change.kind === 'FIELD_REMOVED' ? 'no longer sent' : `${change.before} -> ${change.after}`})`).join(', ')}.` : '',
  ].filter(Boolean).join(' ');
  const suggestedFix = [
    'Search your webhook handler for each changed field and read it from its new location.',
    readByChecks ? 'At least one outcome check reads a changed field: update its bindings too.' : '',
    'Watch your outcome checks over the next hour; if they keep passing, resolve this incident. Stripe upgrade notes: https://docs.stripe.com/upgrades',
  ].filter(Boolean).join(' ');
  return {
    rootCause: rootCause || 'Stripe changed what it sends to your webhook.',
    suggestedFix,
    confidence: 0.8,
    evidence: changes.map(change => `${change.kind}${change.eventType ? ` · ${change.eventType}` : ''}${change.path ? ` · ${change.path}` : ''}`),
  };
}
