// Stripe change monitor: watches every Stripe webhook for a new API version and
// for fields that disappear or change type (stripe-shape.ts), records each
// change, and opens one incident per burst of changes, HIGH when an outcome
// check reads the changed field. Only webhooks are observed: they are what the
// customer's code receives, and Events API reads may render another version.
import { IncidentSeverity, IncidentStatus, StripeChangeKind, type Prisma, type StripeChange } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { queueIncidentAlert } from './alert-queue.js';
import {
  emptyShape,
  flattenShape,
  isNewerApiVersion,
  observeShape,
  pathsOverlap,
  type ShapeChange,
  type ShapeState,
} from './stripe-shape.js';

const OPEN = [IncidentStatus.DETECTED, IncidentStatus.TRIAGED, IncidentStatus.REPLAYING];
/** Changes within this window join the same incident (an upgrade touches many event types). */
export const CHANGE_INCIDENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const UPGRADE_GUIDE = 'https://docs.stripe.com/upgrades';

type CheckRef = { id: string; name: string };
type ChangeInput = Omit<Prisma.StripeChangeUncheckedCreateInput, 'integrationId'>;

export function describeChange(change: Pick<StripeChange, 'kind' | 'eventType' | 'path' | 'before' | 'after' | 'apiVersion'>, checks: CheckRef[] = []): string {
  const readers = checks.length ? ` Read by your outcome check${checks.length > 1 ? 's' : ''} ${checks.map(check => `"${check.name}"`).join(', ')}.` : '';
  if (change.kind === StripeChangeKind.API_VERSION) {
    return `Stripe now sends webhooks with API version ${change.after}${change.before ? ` (was ${change.before})` : ''}. Upgrades can move or remove fields your webhook handler reads.`;
  }
  if (change.kind === StripeChangeKind.FIELD_REMOVED) {
    return `${change.eventType}: ${change.path} is no longer sent (it was ${article(change.before)}).${readers}`;
  }
  return `${change.eventType}: ${change.path} changed from ${article(change.before)} to ${article(change.after)}.${readers}`;
}

function article(kind: string | null): string {
  if (!kind) return 'a value';
  return `${/^[aeio]/.test(kind) ? 'an' : 'a'} ${kind}`;
}

function incidentTitle(changes: StripeChange[]): string {
  const version = changes.find(change => change.kind === StripeChangeKind.API_VERSION);
  if (version) return `Stripe API version changed to ${version.after}`;
  const types = [...new Set(changes.map(change => change.eventType))];
  return types.length === 1 ? `Stripe changed ${types[0]} payloads` : 'Stripe changed webhook payloads';
}

function incidentDescription(changes: StripeChange[], checksById: Map<string, CheckRef>): string {
  const lines = changes.map(change => `- ${describeChange(change, change.affectedCheckIds.map(id => checksById.get(id)).filter((c): c is CheckRef => Boolean(c)))}`);
  return [
    'What Stripe sends to your webhook changed. Code that reads the old fields can stop provisioning customers without any error.',
    ...lines,
    `Check that your webhook handler reads the new fields, then resolve this incident. Stripe's upgrade notes: ${UPGRADE_GUIDE}`,
  ].join('\n');
}

/**
 * Observe one verified Stripe webhook. Never throws: monitoring must not
 * break webhook processing.
 */
export async function observeStripeEvent(integrationId: string, payload: Record<string, unknown>, now = new Date()): Promise<StripeChange[]> {
  try {
    return await observe(integrationId, payload, now);
  } catch (error) {
    logger.error({ integrationId, error: error instanceof Error ? error.message : String(error) }, 'Stripe change monitor failed');
    return [];
  }
}

async function observe(integrationId: string, payload: Record<string, unknown>, now: Date): Promise<StripeChange[]> {
  const eventType = typeof payload.type === 'string' ? payload.type : null;
  if (!eventType) return [];
  const apiVersion = typeof payload.api_version === 'string' && payload.api_version ? payload.api_version : null;
  const sourceEventId = typeof payload.id === 'string' ? payload.id : null;

  const result = await prisma.$transaction(async tx => {
    // One observer per integration at a time: version and shape updates are read-modify-write.
    await tx.$queryRaw`SELECT id FROM "Integration" WHERE id = ${integrationId} FOR UPDATE`;
    const integration = await tx.integration.findUniqueOrThrow({ where: { id: integrationId }, select: { providerApiVersion: true } });
    const pending: ChangeInput[] = [];

    const previous = integration.providerApiVersion;
    if (apiVersion && previous && !isNewerApiVersion(apiVersion, previous) && apiVersion !== previous) {
      // A late retry of an event from before an upgrade: neither a change nor a new shape sample.
      return null;
    }
    if (apiVersion && apiVersion !== previous) {
      await tx.integration.update({ where: { id: integrationId }, data: { providerApiVersion: apiVersion } });
      if (previous) pending.push({ kind: StripeChangeKind.API_VERSION, before: previous, after: apiVersion, apiVersion, sourceEventId, eventType });
    }

    const stored = await tx.stripeEventShape.findUnique({ where: { integrationId_eventType: { integrationId, eventType } } });
    const state: ShapeState = stored ? { samples: stored.samples, paths: stored.paths as ShapeState['paths'] } : emptyShape();
    const observed = observeShape(state, flattenShape(payload));
    await tx.stripeEventShape.upsert({
      where: { integrationId_eventType: { integrationId, eventType } },
      create: { integrationId, eventType, samples: observed.state.samples, paths: observed.state.paths as Prisma.InputJsonValue },
      update: { samples: observed.state.samples, paths: observed.state.paths as Prisma.InputJsonValue },
    });
    if (!pending.length && !observed.changes.length) return null;

    const checks = await tx.outcomeCheck.findMany({
      where: { integrationId, enabled: true },
      select: { id: true, name: true, triggerEventType: true, paramBindings: true },
    });
    const readers = (change: ShapeChange) => checks
      .filter(check => check.triggerEventType === eventType
        && Object.values((check.paramBindings ?? {}) as Record<string, string>).some(binding => pathsOverlap(change.path, binding)))
      .map(check => check.id);
    for (const change of observed.changes) {
      pending.push({
        kind: change.kind === 'FIELD_REMOVED' ? StripeChangeKind.FIELD_REMOVED : StripeChangeKind.TYPE_CHANGED,
        eventType,
        path: change.path,
        before: change.before,
        after: change.kind === 'TYPE_CHANGED' ? change.after : null,
        apiVersion,
        sourceEventId,
        affectedCheckIds: readers(change),
      });
    }

    // Join an open change incident from the same burst, or open one.
    const recent = await tx.stripeChange.findFirst({
      where: {
        integrationId,
        detectedAt: { gte: new Date(now.getTime() - CHANGE_INCIDENT_WINDOW_MS) },
        incident: { status: { in: OPEN } },
      },
      orderBy: { detectedAt: 'desc' },
      select: { incidentId: true },
    });
    const affectsCheck = pending.some(change => (change.affectedCheckIds as string[] | undefined)?.length);
    let incidentId = recent?.incidentId ?? null;
    const opened = !incidentId;
    if (!incidentId) {
      const incident = await tx.incident.create({
        data: {
          integrationId,
          title: 'Stripe changed webhook payloads',
          description: '',
          severity: affectsCheck ? IncidentSeverity.HIGH : IncidentSeverity.MEDIUM,
          status: IncidentStatus.DETECTED,
          detectedAt: now,
        },
      });
      incidentId = incident.id;
    }
    const created: StripeChange[] = [];
    for (const change of pending) created.push(await tx.stripeChange.create({ data: { ...change, integrationId, incidentId, detectedAt: now } }));

    const linked = await tx.stripeChange.findMany({ where: { incidentId }, orderBy: { detectedAt: 'asc' } });
    const checksById = new Map(checks.map(check => [check.id, { id: check.id, name: check.name }]));
    await tx.incident.update({
      where: { id: incidentId },
      data: {
        title: incidentTitle(linked),
        description: incidentDescription(linked, checksById),
        ...(affectsCheck ? { severity: IncidentSeverity.HIGH } : {}),
      },
    });
    return { incidentId, opened, created };
  });

  if (!result) return [];
  logger.info({ integrationId, incidentId: result.incidentId, changes: result.created.length }, 'Stripe change detected');
  if (result.opened) await queueIncidentAlert(result.incidentId);
  return result.created;
}
