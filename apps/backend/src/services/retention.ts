import { IncidentStatus, OutcomeRunStatus } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 2000;
const OPEN_INCIDENTS = [IncidentStatus.DETECTED, IncidentStatus.TRIAGED, IncidentStatus.REPLAYING];

export type PurgeResult = Record<string, number>;

/** Delete in batches so one purge never holds a long lock on a big table. */
async function deleteInBatches(
  findIds: (take: number) => Promise<{ id: string }[]>,
  deleteIds: (ids: string[]) => Promise<{ count: number }>,
): Promise<number> {
  let total = 0;
  for (;;) {
    const rows = await findIds(BATCH);
    if (rows.length === 0) return total;
    total += (await deleteIds(rows.map(row => row.id))).count;
    if (rows.length < BATCH) return total;
  }
}

/**
 * Delete data past its retention. Customer-derived payloads (Stripe events and
 * SDK events) and finished check runs go after SHAPI_RETENTION_DAYS; closed
 * incidents go with them. Anything an open incident still needs is kept.
 * Expired login sessions, reset links and invites are cleared as well.
 */
export async function purgeExpiredData(now = new Date(), retentionDays = config.SHAPI_RETENTION_DAYS): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  const result: PurgeResult = {};

  result.webhookEvents = await deleteInBatches(
    take => prisma.webhookEvent.findMany({
      where: {
        receivedAt: { lt: cutoff },
        replayJobs: { none: { incident: { status: { in: OPEN_INCIDENTS } } } },
      },
      select: { id: true },
      take,
    }),
    ids => prisma.webhookEvent.deleteMany({ where: { id: { in: ids } } }),
  );

  result.trackedEvents = await deleteInBatches(
    take => prisma.trackedEvent.findMany({ where: { timestamp: { lt: cutoff } }, select: { id: true }, take }),
    ids => prisma.trackedEvent.deleteMany({ where: { id: { in: ids } } }),
  );

  result.outcomeCheckRuns = await deleteInBatches(
    take => prisma.outcomeCheckRun.findMany({
      where: { createdAt: { lt: cutoff }, status: { not: OutcomeRunStatus.PENDING } },
      select: { id: true },
      take,
    }),
    ids => prisma.outcomeCheckRun.deleteMany({ where: { id: { in: ids } } }),
  );

  result.incidents = await deleteInBatches(
    take => prisma.incident.findMany({
      where: { status: { in: [IncidentStatus.RESOLVED, IncidentStatus.DISMISSED, IncidentStatus.REPAIRED] }, updatedAt: { lt: cutoff } },
      select: { id: true },
      take,
    }),
    ids => prisma.incident.deleteMany({ where: { id: { in: ids } } }),
  );

  result.driftResults = (await prisma.driftResult.deleteMany({ where: { detectedAt: { lt: cutoff } } })).count;
  result.sessions = (await prisma.authSession.deleteMany({ where: { expiresAt: { lt: now } } })).count;
  result.resetLinks = (await prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: now } } })).count;
  result.invites = (await prisma.workspaceInvite.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 7 * DAY_MS) } } })).count;

  const removed = Object.values(result).reduce((sum, count) => sum + count, 0);
  if (removed > 0) logger.info({ retentionDays, ...result }, 'Retention purge removed expired data');
  return result;
}

const PURGE_EVERY_MS = 6 * 60 * 60 * 1000;
let lastPurge = 0;

/** Called from the scheduler tick; does real work at most every six hours. */
export async function purgeIfDue(now = new Date()): Promise<void> {
  if (now.getTime() - lastPurge < PURGE_EVERY_MS) return;
  lastPurge = now.getTime();
  await purgeExpiredData(now);
}

/**
 * Permanently delete a workspace and everything in it: connections (and their
 * stored credentials), events, incidents, checks, alert destinations, members,
 * sessions and API keys. Integrations, tracked events and API keys are only
 * detached from the tenant by the schema, so they are deleted explicitly.
 */
export async function deleteWorkspace(tenantId: string): Promise<void> {
  await prisma.$transaction(async tx => {
    await tx.integration.deleteMany({ where: { tenantId } });
    await tx.trackedEvent.deleteMany({ where: { tenantId } });
    await tx.aPIKey.deleteMany({ where: { tenantId } });
    await tx.tenant.delete({ where: { id: tenantId } });
  }, { timeout: 120_000, maxWait: 10_000 });
}
