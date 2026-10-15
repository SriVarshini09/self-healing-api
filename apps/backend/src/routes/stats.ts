// Dashboard overview statistics: daily trends, period comparison, integration
// health and a short activity feed, all scoped to the caller's tenant.
import type { FastifyInstance } from 'fastify';
import { Prisma, IncidentStatus } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { tenantIdFor } from '../utils/auth-context.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Business-outcome events: SHAPI outcome checks plus the SDK's success/failure
// pairs (e.g. provisioning.completed / provisioning.failed).
const FAILED_OUTCOME = Prisma.sql`("type" LIKE 'outcome.failed.%' OR "type" LIKE '%.failed' OR "type" LIKE '%activation_failed')`;
const PASSED_OUTCOME = Prisma.sql`("type" LIKE 'outcome.passed.%' OR "type" LIKE '%.completed' OR "type" LIKE '%.activated')`;

export interface DayBucket {
  date: string;
  events: number;
  outcomesPassed: number;
  outcomesFailed: number;
  incidentsOpened: number;
  incidentsResolved: number;
}

type DailyRow = { day: Date; count: bigint | number };

export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** One bucket per UTC day from `from` through `to`, zero-filled. */
export function emptyBuckets(from: Date, to: Date): DayBucket[] {
  const buckets: DayBucket[] = [];
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  for (let time = start; time <= to.getTime(); time += DAY_MS) {
    buckets.push({ date: dayKey(new Date(time)), events: 0, outcomesPassed: 0, outcomesFailed: 0, incidentsOpened: 0, incidentsResolved: 0 });
  }
  return buckets;
}

export function fillBuckets(buckets: DayBucket[], rows: DailyRow[], field: Exclude<keyof DayBucket, 'date'>): void {
  const byDay = new Map(buckets.map(bucket => [bucket.date, bucket]));
  for (const row of rows) {
    const bucket = byDay.get(dayKey(new Date(row.day)));
    if (bucket) bucket[field] += Number(row.count);
  }
}

function sum(buckets: DayBucket[], field: Exclude<keyof DayBucket, 'date'>): number {
  return buckets.reduce((total, bucket) => total + bucket[field], 0);
}

export async function statsRoutes(app: FastifyInstance) {
  app.get('/stats/overview', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const requested = Number((request.query as { days?: string } | undefined)?.days ?? 14);
    const days = Number.isFinite(requested) ? Math.min(90, Math.max(7, Math.round(requested))) : 14;

    const now = new Date();
    const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const from = new Date(todayStart - (days - 1) * DAY_MS);
    const previousFrom = new Date(from.getTime() - days * DAY_MS);

    const daily = async (sql: Prisma.Sql) => prisma.$queryRaw<DailyRow[]>(sql);
    // Columns are timestamp-without-time-zone holding UTC; compare in UTC so the
    // database session's TimeZone setting cannot shift days.
    const utc = (date: Date) => Prisma.sql`(${date}::timestamptz AT TIME ZONE 'UTC')`;
    const eventsSql = (start: Date, end: Date) => Prisma.sql`
      SELECT date_trunc('day', w."receivedAt") AS day, count(*) AS count
      FROM "WebhookEvent" w JOIN "Integration" i ON i.id = w."integrationId"
      WHERE i."tenantId" = ${tenantId} AND w."receivedAt" >= ${utc(start)} AND w."receivedAt" < ${utc(end)}
      GROUP BY 1`;
    const outcomesSql = (condition: Prisma.Sql, start: Date, end: Date) => Prisma.sql`
      SELECT date_trunc('day', "timestamp") AS day, count(*) AS count
      FROM "TrackedEvent"
      WHERE "tenantId" = ${tenantId} AND "timestamp" >= ${utc(start)} AND "timestamp" < ${utc(end)} AND ${condition}
      GROUP BY 1`;
    const incidentsSql = (column: 'detectedAt' | 'resolvedAt', start: Date, end: Date) => Prisma.sql`
      SELECT date_trunc('day', x.${Prisma.raw(`"${column}"`)}) AS day, count(*) AS count
      FROM "Incident" x JOIN "Integration" i ON i.id = x."integrationId"
      WHERE i."tenantId" = ${tenantId} AND x.${Prisma.raw(`"${column}"`)} >= ${utc(start)} AND x.${Prisma.raw(`"${column}"`)} < ${utc(end)}
      GROUP BY 1`;

    const end = new Date(todayStart + DAY_MS);
    const [events, passed, failed, opened, resolved, prevEvents, prevPassed, prevFailed, prevOpened] = await Promise.all([
      daily(eventsSql(from, end)),
      daily(outcomesSql(PASSED_OUTCOME, from, end)),
      daily(outcomesSql(FAILED_OUTCOME, from, end)),
      daily(incidentsSql('detectedAt', from, end)),
      daily(incidentsSql('resolvedAt', from, end)),
      daily(eventsSql(previousFrom, from)),
      daily(outcomesSql(PASSED_OUTCOME, previousFrom, from)),
      daily(outcomesSql(FAILED_OUTCOME, previousFrom, from)),
      daily(incidentsSql('detectedAt', previousFrom, from)),
    ]);

    const buckets = emptyBuckets(from, new Date(todayStart));
    fillBuckets(buckets, events, 'events');
    fillBuckets(buckets, passed, 'outcomesPassed');
    fillBuckets(buckets, failed, 'outcomesFailed');
    fillBuckets(buckets, opened, 'incidentsOpened');
    fillBuckets(buckets, resolved, 'incidentsResolved');
    const total = (rows: DailyRow[]) => rows.reduce((value, row) => value + Number(row.count), 0);

    const workspace = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
    const openStatuses = [IncidentStatus.DETECTED, IncidentStatus.TRIAGED, IncidentStatus.REPLAYING, IncidentStatus.REPAIRED];
    const [openIncidents, oldestOpen, resolvedInRange, integrations, recentIncidents, recentFailures, recentPrs] = await Promise.all([
      prisma.incident.count({ where: { integration: { tenantId }, status: { in: openStatuses } } }),
      prisma.incident.findFirst({ where: { integration: { tenantId }, status: { in: openStatuses } }, orderBy: { detectedAt: 'asc' }, select: { detectedAt: true } }),
      prisma.incident.findMany({ where: { integration: { tenantId }, resolvedAt: { gte: from } }, select: { detectedAt: true, resolvedAt: true } }),
      prisma.integration.findMany({ where: { tenantId }, select: { id: true, name: true, type: true }, orderBy: { createdAt: 'asc' } }),
      prisma.incident.findMany({
        where: { integration: { tenantId } },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        select: { id: true, title: true, status: true, detectedAt: true, resolvedAt: true, invariant: { select: { name: true } } },
      }),
      prisma.trackedEvent.findMany({
        where: { tenantId, OR: [{ type: { startsWith: 'outcome.failed.' } }, { type: { endsWith: '.failed' } }] },
        orderBy: { timestamp: 'desc' },
        take: 10,
        select: { id: true, type: true, timestamp: true, payload: true },
      }),
      prisma.gitHubPullRequest.findMany({
        where: { incident: { integration: { tenantId } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, prNumber: true, repository: true, createdAt: true, incidentId: true },
      }),
    ]);

    const since24h = new Date(now.getTime() - DAY_MS);
    const integrationHealth = await Promise.all(integrations.map(async integration => {
      const [events24h, last] = await Promise.all([
        prisma.webhookEvent.count({ where: { integrationId: integration.id, receivedAt: { gte: since24h } } }),
        prisma.webhookEvent.findFirst({ where: { integrationId: integration.id }, orderBy: { receivedAt: 'desc' }, select: { receivedAt: true } }),
      ]);
      return { ...integration, events24h, lastEventAt: last?.receivedAt ?? null };
    }));

    const activity = [
      ...recentIncidents.map(incident => ({
        kind: incident.resolvedAt ? 'incident_resolved' : 'incident_opened',
        at: (incident.resolvedAt ?? incident.detectedAt).toISOString(),
        title: incident.invariant?.name ?? incident.title,
        incidentId: incident.id,
      })),
      ...recentFailures.map(event => {
        const payload = (event.payload ?? {}) as { checkName?: string; customer?: string; params?: Record<string, unknown> };
        const customer = payload.customer ?? (payload.params?.customer as string | undefined);
        return {
          kind: 'outcome_failed',
          at: event.timestamp.toISOString(),
          title: `${payload.checkName ?? event.type.replace(/^outcome\.failed\..*$/, 'Outcome check')}${customer ? ` · ${customer}` : ''}`,
          incidentId: null,
        };
      }),
      ...recentPrs.map(pr => ({
        kind: 'pr_opened',
        at: pr.createdAt.toISOString(),
        title: `${pr.repository}#${pr.prNumber}`,
        incidentId: pr.incidentId,
      })),
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);

    const resolveSeconds = resolvedInRange
      .filter(incident => incident.resolvedAt)
      .map(incident => (incident.resolvedAt!.getTime() - incident.detectedAt.getTime()) / 1000);

    return reply.send({
      workspace: { name: workspace?.name ?? 'Workspace' },
      range: { days, from: from.toISOString(), to: now.toISOString() },
      days: buckets,
      totals: {
        events: sum(buckets, 'events'),
        outcomesPassed: sum(buckets, 'outcomesPassed'),
        outcomesFailed: sum(buckets, 'outcomesFailed'),
        incidentsOpened: sum(buckets, 'incidentsOpened'),
        incidentsResolved: sum(buckets, 'incidentsResolved'),
      },
      previous: {
        events: total(prevEvents),
        outcomesPassed: total(prevPassed),
        outcomesFailed: total(prevFailed),
        incidentsOpened: total(prevOpened),
      },
      openIncidents,
      oldestOpenIncidentAt: oldestOpen?.detectedAt.toISOString() ?? null,
      meanTimeToResolveSec: resolveSeconds.length ? Math.round(resolveSeconds.reduce((a, b) => a + b, 0) / resolveSeconds.length) : null,
      integrations: integrationHealth.map(item => ({ ...item, lastEventAt: item.lastEventAt?.toISOString() ?? null })),
      activity,
    });
  });
}
