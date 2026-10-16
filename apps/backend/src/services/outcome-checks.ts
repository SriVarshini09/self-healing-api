// Outcome checks: after a provider event (e.g. Stripe invoice.payment_succeeded)
// verify the expected business outcome exists in the customer's own database
// within a deadline. Failures flow into the existing invariant + incident
// pipeline through one auto-managed invariant per check.
//
// Two event sources feed the same run queue (deduped per check + event id):
//  - WEBHOOK: Stripe webhooks SHAPI already receives
//  - RECONCILE: Stripe's Events API read with a restricted key, so a customer
//    can connect without changing any webhook configuration at all.
import Stripe from 'stripe';
import { OutcomeRunSource, OutcomeRunStatus, type OutcomeCheck, type Prisma } from '@prisma/client';
import {
  bindParams,
  runOutcomeQuery,
  sqlParamNames,
  type OutcomeQueryResult,
  type ParamBindings,
  type ParamValue,
  type RunOutcomeQueryOptions,
} from '@shapi/outcome-checks';
import { blockPrivateDatabaseHosts } from '../config.js';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { decryptSecret } from '../utils/secrets.js';
import { evaluateInvariantsForEvent } from './invariants.js';

export const OUTCOME_MAX_ATTEMPTS = 3;
export const OUTCOME_RETRY_DELAY_MS = 60_000;
export const STRIPE_RECONCILE_INTERVAL_MS = 15 * 60_000;
const FIRST_RECONCILE_LOOKBACK_MS = 24 * 60 * 60_000;
export const MAX_RECONCILE_EVENTS = 1000;

export interface StripeEventLike {
  id: string;
  created: number;
  type: string;
  data?: unknown;
}

export interface OutcomeDeps {
  runQuery: (options: RunOutcomeQueryOptions) => Promise<OutcomeQueryResult>;
  listStripeEvents: (apiKey: string, type: string, sinceSec: number, limit: number) => Promise<StripeEventLike[]>;
}

async function listStripeEvents(apiKey: string, type: string, sinceSec: number, limit: number): Promise<StripeEventLike[]> {
  const stripe = new Stripe(apiKey);
  const events: StripeEventLike[] = [];
  for await (const event of stripe.events.list({ type, created: { gte: sinceSec }, limit: 100 })) {
    events.push(event as unknown as StripeEventLike);
    if (events.length >= limit) break;
  }
  return events;
}

export const defaultOutcomeDeps: OutcomeDeps = { runQuery: runOutcomeQuery, listStripeEvents };

export function outcomeInvariantId(checkId: string): string {
  return `outcome-${checkId}`;
}

export function outcomeEventTypes(checkId: string) {
  return { passed: `outcome.passed.${checkId}`, failed: `outcome.failed.${checkId}` };
}

/**
 * Scoped to exactly this check's two outcome event types (so no other event
 * can count as a sample) and true only for a passed outcome.
 */
export function outcomeInvariantPredicate(checkId: string): string {
  const { passed, failed } = outcomeEventTypes(checkId);
  return `(event.type === '${passed}' || event.type === '${failed}') && event.type === '${passed}'`;
}

export async function syncOutcomeInvariant(check: OutcomeCheck): Promise<void> {
  const id = outcomeInvariantId(check.id);
  const predicateDescription =
    `Every ${check.triggerEventType} must produce the expected database outcome within ${check.deadlineSec}s`;
  const fields = {
    name: `Outcome: ${check.name}`,
    description: check.description || predicateDescription,
    predicateDescription,
  };
  await prisma.invariant.upsert({
    where: { id },
    update: fields,
    create: {
      id,
      integrationId: check.integrationId,
      ...fields,
      predicateExpression: outcomeInvariantPredicate(check.id),
      predicateExample: `event.type === '${outcomeEventTypes(check.id).passed}'`,
      evaluationWindowSec: 3600,
      minSamples: 1,
      expectedSuccessRate: 1,
    },
  });
}

export async function deleteOutcomeInvariant(checkId: string): Promise<void> {
  await prisma.invariant.deleteMany({ where: { id: outcomeInvariantId(checkId) } });
}

/** Queue one run for a check. Returns 1 when queued, 0 when this event was already queued. */
async function queueRun(
  check: OutcomeCheck,
  sourceEventId: string,
  payload: unknown,
  occurredAt: Date,
  source: OutcomeRunSource,
  now: Date,
): Promise<number> {
  const names = sqlParamNames(check.sqlQuery);
  let params: Record<string, ParamValue> = {};
  let status: OutcomeRunStatus = OutcomeRunStatus.PENDING;
  let detail: string | null = null;
  try {
    const values = bindParams(names, check.paramBindings as ParamBindings, payload);
    params = Object.fromEntries(names.map((name, index) => [name, values[index]]));
  } catch (error) {
    // A check that cannot bind is a monitoring gap, not a customer failure:
    // record it as ERROR (visible on the check) instead of paging.
    status = OutcomeRunStatus.ERROR;
    detail = error instanceof Error ? error.message : String(error);
  }
  const dueAt = new Date(Math.max(occurredAt.getTime() + check.deadlineSec * 1000, now.getTime()));
  const { count } = await prisma.outcomeCheckRun.createMany({
    data: [{
      checkId: check.id,
      sourceEventId,
      source,
      params: params as Prisma.InputJsonValue,
      dueAt,
      status,
      detail,
      checkedAt: status === OutcomeRunStatus.ERROR ? now : null,
    }],
    skipDuplicates: true,
  });
  return count;
}

export async function enqueueOutcomeRuns(
  integrationId: string,
  eventType: string,
  sourceEventId: string,
  payload: unknown,
  occurredAt: Date,
  source: OutcomeRunSource,
  now = new Date(),
): Promise<number> {
  const checks = await prisma.outcomeCheck.findMany({
    where: { integrationId, triggerEventType: eventType, enabled: true },
  });
  let queued = 0;
  for (const check of checks) {
    queued += await queueRun(check, sourceEventId, payload, occurredAt, source, now);
  }
  return queued;
}

async function recordOutcome(
  check: OutcomeCheck,
  run: { id: string; sourceEventId: string; params: unknown },
  matched: boolean,
): Promise<void> {
  const integration = await prisma.integration.findUnique({
    where: { id: check.integrationId },
    select: { tenantId: true, type: true },
  });
  if (!integration) return;
  const types = outcomeEventTypes(check.id);
  const type = matched ? types.passed : types.failed;
  const payload = {
    checkId: check.id,
    checkName: check.name,
    triggerEventType: check.triggerEventType,
    sourceEventId: run.sourceEventId,
    params: run.params,
    matched,
  };
  // One recorded outcome per run (the run id is unique); recording twice is a no-op.
  const eventId = `outcome:${run.id}`;
  const recorded = await prisma.trackedEvent.findFirst({ where: { tenantId: integration.tenantId, eventId }, select: { id: true } });
  if (!recorded) {
    await prisma.trackedEvent.create({
      data: {
        eventId,
        tenantId: integration.tenantId,
        integration: integration.type,
        type,
        payload: payload as Prisma.InputJsonValue,
        correlationId: run.sourceEventId,
      },
    });
  }
  await evaluateInvariantsForEvent(check.integrationId, type, payload, {}, {
    invariantIds: [outcomeInvariantId(check.id)],
  });
}

export async function processDueOutcomeRuns(
  now = new Date(),
  deps: OutcomeDeps = defaultOutcomeDeps,
  limit = 50,
): Promise<{ processed: number; passed: number; failed: number; errors: number }> {
  const runs = await prisma.outcomeCheckRun.findMany({
    where: { status: OutcomeRunStatus.PENDING, dueAt: { lte: now } },
    orderBy: { dueAt: 'asc' },
    take: limit,
    include: { check: true },
  });
  const summary = { processed: 0, passed: 0, failed: 0, errors: 0 };

  for (const run of runs) {
    // Claim the run so a second scheduler replica cannot process it twice.
    const claimed = await prisma.outcomeCheckRun.updateMany({
      where: { id: run.id, status: OutcomeRunStatus.PENDING, attempts: run.attempts },
      data: { attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;
    summary.processed++;
    const attempt = run.attempts + 1;

    try {
      if (!run.check.enabled) throw new Error('Outcome check is disabled');
      const names = sqlParamNames(run.check.sqlQuery);
      const stored = (run.params ?? {}) as Record<string, ParamValue>;
      const missing = names.filter(name => !(name in stored));
      if (missing.length) throw new Error(`Run has no value for parameter(s): ${missing.join(', ')}`);

      const result = await deps.runQuery({
        connectionString: decryptSecret(run.check.databaseUrlCipher),
        sql: run.check.sqlQuery,
        params: names.map(name => stored[name]),
        blockPrivateHosts: blockPrivateDatabaseHosts(),
      });
      const status = result.matched ? OutcomeRunStatus.PASSED : OutcomeRunStatus.FAILED;
      await prisma.outcomeCheckRun.update({
        where: { id: run.id },
        data: {
          status,
          checkedAt: now,
          detail: result.matched ? null : 'Outcome query returned no rows after the deadline',
        },
      });
      if (run.check.lastError) {
        await prisma.outcomeCheck.update({ where: { id: run.check.id }, data: { lastError: null } });
      }
      await recordOutcome(run.check, run, result.matched);
      if (result.matched) summary.passed++;
      else summary.failed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const finalAttempt = attempt >= OUTCOME_MAX_ATTEMPTS || !run.check.enabled;
      await prisma.outcomeCheckRun.update({
        where: { id: run.id },
        data: finalAttempt
          ? { status: OutcomeRunStatus.ERROR, checkedAt: now, detail: message }
          : { dueAt: new Date(now.getTime() + OUTCOME_RETRY_DELAY_MS), detail: message },
      });
      await prisma.outcomeCheck.update({ where: { id: run.check.id }, data: { lastError: message } });
      logger.warn({ checkId: run.check.id, runId: run.id, attempt, error: message }, 'Outcome check run failed to execute');
      if (finalAttempt) summary.errors++;
    }
  }
  return summary;
}

export async function reconcileOutcomeCheck(
  check: OutcomeCheck,
  sinceSec: number,
  now = new Date(),
  deps: OutcomeDeps = defaultOutcomeDeps,
): Promise<{ eventsSeen: number; runsQueued: number }> {
  if (!check.stripeApiKeyCipher) throw new Error('Outcome check has no Stripe API key');
  const events = await deps.listStripeEvents(
    decryptSecret(check.stripeApiKeyCipher),
    check.triggerEventType,
    sinceSec,
    MAX_RECONCILE_EVENTS,
  );
  let runsQueued = 0;
  for (const event of events) {
    if (event.type !== check.triggerEventType) continue;
    runsQueued += await queueRun(check, event.id, event, new Date(event.created * 1000), OutcomeRunSource.RECONCILE, now);
  }
  // Stripe lists newest first, so hitting the cap means the OLDEST events of this pass were not
  // looked at, and the next pass starts later. Say so on the check rather than pretending
  // the reconcile was complete.
  const capped = events.length >= MAX_RECONCILE_EVENTS;
  if (capped) logger.warn({ checkId: check.id, cap: MAX_RECONCILE_EVENTS }, 'Stripe reconcile hit its event cap');
  await prisma.outcomeCheck.update({
    where: { id: check.id },
    data: {
      lastReconciledAt: now,
      lastError: capped
        ? `Stripe reconcile saw ${MAX_RECONCILE_EVENTS}+ events in one pass, so the oldest were not checked. Checks driven by webhooks are not affected.`
        : null,
    },
  });
  return { eventsSeen: events.length, runsQueued };
}

/** Scheduler entry point: reconcile every Stripe-connected check at most every 15 minutes. */
export async function reconcileDueStripeChecks(now = new Date(), deps: OutcomeDeps = defaultOutcomeDeps): Promise<void> {
  const checks = await prisma.outcomeCheck.findMany({
    where: {
      enabled: true,
      stripeApiKeyCipher: { not: null },
      OR: [{ lastReconciledAt: null }, { lastReconciledAt: { lt: new Date(now.getTime() - STRIPE_RECONCILE_INTERVAL_MS) } }],
    },
  });
  for (const check of checks) {
    // Overlap the previous pass by the deadline plus an hour so late events are not missed.
    const from = check.lastReconciledAt
      ? check.lastReconciledAt.getTime() - (check.deadlineSec * 1000 + 3_600_000)
      : now.getTime() - FIRST_RECONCILE_LOOKBACK_MS;
    try {
      await reconcileOutcomeCheck(check, Math.floor(from / 1000), now, deps);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.outcomeCheck.update({ where: { id: check.id }, data: { lastError: `Stripe reconcile: ${message}` } });
      logger.warn({ checkId: check.id, error: message }, 'Stripe reconcile failed');
    }
  }
}
