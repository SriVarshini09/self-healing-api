import { AlertDeliveryStatus, OutcomeRunStatus, WebhookEventStatus } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { setGauge } from '../utils/metrics.js';
import { emailAvailable, sendEmail } from './email.js';

// SHAPI exists to catch silent failures, so it must not have one of its own: a
// stopped scheduler or a pile of unprocessed work looks exactly like "all green".
// This watches SHAPI's own pipeline and tells the operator (email), the customer
// (a banner in the dashboard) and, if configured, an external dead-man's switch
// (SHAPI_HEARTBEAT_URL) that notices even when the whole process is gone.

export type CheckName = 'database' | 'scheduler' | 'outcome-runs' | 'alerts' | 'webhook-events';
export type SelfCheck = { name: CheckName; label: string; ok: boolean; detail: string };
export type SelfStatus = { status: 'ok' | 'degraded'; checkedAt: string; checks: SelfCheck[] };

const MINUTE = 60_000;
/** Work this far past due counts as stuck. Generous, so a slow tick is not an incident. */
export const OVERDUE_RUN_MS = 10 * MINUTE;
export const STUCK_ALERT_MS = 15 * MINUTE;
export const STUCK_EVENT_MS = 15 * MINUTE;
const STATUS_CACHE_MS = 15_000;
const REPEAT_EMAIL_MS = 6 * 60 * MINUTE;

const processStartedAt = Date.now();
let lastTickAt: number | null = null;
let lastTickOkAt: number | null = null;

/** Called by the scheduler: a tick started, and (ok) whether it finished without errors. */
export function recordSchedulerTick(ok?: boolean, now = Date.now()): void {
  if (ok === undefined) lastTickAt = now;
  else if (ok) lastTickOkAt = now;
}

/** How long without a clean tick before the scheduler counts as stalled. */
export function schedulerStallMs(intervalSec = config.INVARIANT_EVALUATION_INTERVAL_SEC): number {
  return Math.max(3 * intervalSec * 1000, 3 * MINUTE);
}

export function resetSelfMonitorForTests(): void {
  lastTickAt = null;
  lastTickOkAt = null;
  cached = null;
  states.clear();
}

async function count(promise: Promise<number>): Promise<number | null> {
  try { return await promise; } catch { return null; }
}

let cached: { at: number; status: SelfStatus } | null = null;

export async function getSelfStatus(now = new Date(), { fresh = false } = {}): Promise<SelfStatus> {
  if (!fresh && cached && now.getTime() - cached.at < STATUS_CACHE_MS) return cached.status;
  const t = now.getTime();
  const checks: SelfCheck[] = [];

  let dbOk = true;
  try { await prisma.$queryRaw`SELECT 1`; } catch { dbOk = false; }
  checks.push({ name: 'database', label: 'Database', ok: dbOk, detail: dbOk ? 'Reachable.' : 'SHAPI cannot reach its database.' });

  const reference = lastTickOkAt ?? lastTickAt ?? processStartedAt;
  const stalledFor = t - reference;
  const schedulerOk = stalledFor <= schedulerStallMs();
  checks.push({
    name: 'scheduler', label: 'Background processing', ok: schedulerOk,
    detail: schedulerOk ? 'Running.' : `No clean processing cycle for ${Math.round(stalledFor / MINUTE)} minutes; checks and alerts may be late.`,
  });

  if (dbOk) {
    const [overdueRuns, stuckAlerts, stuckEvents] = await Promise.all([
      count(prisma.outcomeCheckRun.count({ where: { status: OutcomeRunStatus.PENDING, dueAt: { lt: new Date(t - OVERDUE_RUN_MS) } } })),
      count(prisma.alertDelivery.count({
        where: { status: { in: [AlertDeliveryStatus.PENDING, AlertDeliveryStatus.RETRYING] }, nextAttemptAt: { lt: new Date(t - STUCK_ALERT_MS) } },
      })),
      count(prisma.webhookEvent.count({
        where: { status: { in: [WebhookEventStatus.RECEIVED, WebhookEventStatus.PROCESSING] }, receivedAt: { lt: new Date(t - STUCK_EVENT_MS) } },
      })),
    ]);
    // Counts are global across workspaces and kept out of the customer-facing detail.
    checks.push(
      { name: 'outcome-runs', label: 'Outcome checks', ok: !overdueRuns, detail: overdueRuns ? 'Some checks are running late.' : 'On time.' },
      { name: 'alerts', label: 'Alert delivery', ok: !stuckAlerts, detail: stuckAlerts ? 'Some alerts are waiting to be delivered.' : 'On time.' },
      { name: 'webhook-events', label: 'Event processing', ok: !stuckEvents, detail: stuckEvents ? 'Some received events are not processed yet.' : 'On time.' },
    );
    setGauge('shapi_outcome_runs_overdue', overdueRuns ?? 0);
    setGauge('shapi_alerts_stuck', stuckAlerts ?? 0);
    setGauge('shapi_webhook_events_stuck', stuckEvents ?? 0);
  }

  setGauge('shapi_scheduler_seconds_since_ok_tick', Math.round(stalledFor / 1000));
  for (const check of checks) setGauge('shapi_self_check_ok', check.ok ? 1 : 0, { check: check.name });

  const status: SelfStatus = { status: checks.every(check => check.ok) ? 'ok' : 'degraded', checkedAt: now.toISOString(), checks };
  cached = { at: t, status };
  return status;
}

// ---- Operator email on transitions ---------------------------------------------------

type CheckState = { failing: boolean; lastEmailAt: number };
const states = new Map<CheckName, CheckState>();

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Pure: which emails should go out for this status. Updates the remembered state. */
export function planOperatorEmails(status: SelfStatus, now = Date.now()): Array<{ subject: string; text: string }> {
  const emails: Array<{ subject: string; text: string }> = [];
  for (const check of status.checks) {
    const state = states.get(check.name) ?? { failing: false, lastEmailAt: 0 };
    if (!check.ok) {
      const due = !state.failing || now - state.lastEmailAt >= REPEAT_EMAIL_MS;
      if (due) {
        emails.push({ subject: `[SHAPI] ${check.label}: problem detected`, text: `${check.label}: ${check.detail}\n\nChecked ${status.checkedAt}. SHAPI's own pipeline is degraded, so customers' checks and alerts may be late or missing until this clears.` });
        states.set(check.name, { failing: true, lastEmailAt: now });
      } else {
        states.set(check.name, { ...state, failing: true });
      }
    } else if (state.failing) {
      if (state.lastEmailAt > 0) emails.push({ subject: `[SHAPI] ${check.label}: recovered`, text: `${check.label} is healthy again (checked ${status.checkedAt}).` });
      states.set(check.name, { failing: false, lastEmailAt: 0 });
    }
  }
  return emails;
}

async function pingHeartbeat(): Promise<void> {
  const url = config.SHAPI_HEARTBEAT_URL;
  if (!url) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    await fetch(url, { method: 'GET', signal: controller.signal });
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Heartbeat ping failed');
  } finally {
    clearTimeout(timeout);
  }
}

/** One monitoring pass: check, email the operator on change, ping the dead-man's switch only when healthy. */
export async function runSelfMonitorOnce(now = new Date()): Promise<SelfStatus> {
  const status = await getSelfStatus(now, { fresh: true });
  const to = config.SHAPI_OPERATOR_EMAIL;
  for (const message of planOperatorEmails(status, now.getTime())) {
    logger.warn({ subject: message.subject }, 'SHAPI self-monitor');
    if (!to || !emailAvailable()) continue;
    try {
      await sendEmail({ to: [to], subject: message.subject, text: message.text, html: `<p>${escapeHtml(message.text).replace(/\n/g, '<br>')}</p>` });
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Self-monitor email failed');
    }
  }
  // Silence is the signal: an external service (SHAPI_HEARTBEAT_URL) alerts when pings stop.
  if (status.status === 'ok') await pingHeartbeat();
  return status;
}

export function startSelfMonitor(intervalMs = MINUTE): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runSelfMonitorOnce(); } catch (error) { logger.error({ error }, 'Self-monitor pass failed'); } finally { running = false; }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  // First pass after one interval, so a cold start isn't reported as a stall.
  return () => clearInterval(timer);
}
