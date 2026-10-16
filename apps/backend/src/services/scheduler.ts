import { prisma } from '../utils/prisma.js';
import { checkDrift, recoverPendingWebhookEvents } from '../routes/webhooks.js';
import { evaluateInvariantWindow } from './invariants.js';
import { logger } from '../utils/logger.js';
import { deliverPendingAlerts } from './alerts.js';
import { processDueOutcomeRuns, reconcileDueStripeChecks } from './outcome-checks.js';
import { recordSchedulerTick } from './self-monitor.js';

export async function evaluateAllInvariantWindows(now = new Date()): Promise<void> {
  const invariants = await prisma.invariant.findMany();
  for (const invariant of invariants) {
    const windowStart = new Date(now.getTime() - invariant.evaluationWindowSec * 1000);
    const evaluation = await evaluateInvariantWindow(invariant, windowStart, now);
    if (!evaluation) continue;
    await checkDrift(invariant.id);
    logger.debug({ invariantId: invariant.id, status: evaluation.status }, 'Invariant window evaluated');
  }
}

export function startEvaluationScheduler(intervalSeconds: number): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    recordSchedulerTick();
    try {
      await recoverPendingWebhookEvents();
      await deliverPendingAlerts();
      await evaluateAllInvariantWindows();
      recordSchedulerTick(true);
    } catch (error) {
      logger.error({ error }, 'Scheduled invariant evaluation failed');
    }
    try {
      await reconcileDueStripeChecks();
      await processDueOutcomeRuns();
    } catch (error) {
      logger.error({ error }, 'Scheduled outcome checks failed');
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalSeconds * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
