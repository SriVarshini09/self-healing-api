import { AlertDeliveryStatus, type AlertDestination } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { decryptSecret } from '../utils/secrets.js';
import {
  alertProcessingCutoff,
  buildAlertRequest,
  buildEmailMessage,
  buildSlackMessage,
  destinationChannel,
  nextAlertAttempt,
  parseDestinationChannel,
  type AlertContext,
  type AlertEvent,
  type IncidentAlertInput,
} from './alerts-core.js';

// The operator-level signed webhook (ALERT_WEBHOOK_URL). Workspace destinations
// (Slack, email) use channels named by destinationChannel().
const CHANNEL = 'webhook';
const STALE_PROCESSING_ERROR = 'delivery attempt expired before completion';

/**
 * Queue alerts for an incident: the operator webhook (on detection) and every
 * enabled destination of the incident's workspace. One delivery per incident,
 * destination and event, so a re-evaluated incident never alerts twice.
 * Never throws: alerting must not break incident handling.
 */
export async function enqueueIncidentAlert(incidentId: string, event: AlertEvent = 'detected'): Promise<void> {
  try {
    if (event === 'detected' && config.ALERT_WEBHOOK_URL) {
      await prisma.alertDelivery.upsert({
        where: { incidentId_channel: { incidentId, channel: CHANNEL } },
        create: { incidentId, channel: CHANNEL },
        update: {},
      });
    }
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      select: { integration: { select: { tenantId: true } } },
    });
    const tenantId = incident?.integration.tenantId;
    if (!tenantId) return;
    const destinations = await prisma.alertDestination.findMany({
      where: { tenantId, enabled: true, ...(event === 'resolved' ? { notifyResolved: true } : {}) },
      select: { id: true },
    });
    for (const destination of destinations) {
      const channel = destinationChannel(destination.id, event);
      await prisma.alertDelivery.upsert({
        where: { incidentId_channel: { incidentId, channel } },
        create: { incidentId, channel },
        update: {},
      });
    }
  } catch (error) {
    logger.error({ incidentId, event, error: error instanceof Error ? error.message : String(error) }, 'Failed to queue incident alerts');
  }
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.ALERT_WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'SHAPI-alert-delivery/1.0', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { status: response.status, text: response.ok ? '' : (await response.text().catch(() => '')).slice(0, 300) };
  } finally {
    clearTimeout(timeout);
  }
}

async function sendAlert(incident: IncidentAlertInput): Promise<{ status: number }> {
  if (!config.ALERT_WEBHOOK_URL || !config.ALERT_WEBHOOK_SECRET) {
    throw new Error('Alert webhook is not configured with a signing secret');
  }
  const request = buildAlertRequest(incident, config.ALERT_WEBHOOK_SECRET);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.ALERT_WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(config.ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
    return { status: response.status };
  } finally {
    clearTimeout(timeout);
  }
}

export function emailAlertsAvailable(): boolean {
  return Boolean(config.RESEND_API_KEY && config.ALERT_EMAIL_FROM);
}

/** For outcome-check incidents: which customer paid but wasn't provisioned. */
async function outcomeDetail(incident: IncidentAlertInput): Promise<string | null> {
  const invariantId = incident.invariant?.id;
  if (!invariantId?.startsWith('outcome-')) return null;
  const checkId = invariantId.slice('outcome-'.length);
  const latest = await prisma.trackedEvent.findFirst({
    where: { type: `outcome.failed.${checkId}` },
    orderBy: { timestamp: 'desc' },
    select: { payload: true },
  });
  const payload = (latest?.payload ?? {}) as { params?: Record<string, unknown>; sourceEventId?: string; triggerEventType?: string };
  const customer = payload.params?.customer;
  const values = customer
    ? `Customer ${String(customer)}`
    : payload.params && Object.keys(payload.params).length ? `Values ${JSON.stringify(payload.params)}` : null;
  if (!values) return null;
  return `${values} had a ${payload.triggerEventType ?? 'payment'} (${payload.sourceEventId ?? 'event'}) but the expected database row was not found.`;
}

/** Send one message to a destination right now. Throws with a readable reason on failure. */
export async function sendToDestination(destination: AlertDestination, incident: IncidentAlertInput, ctx: AlertContext): Promise<void> {
  if (destination.kind === 'SLACK') {
    if (!destination.slackUrlCipher) throw new Error('Slack webhook URL is missing');
    const result = await postJson(decryptSecret(destination.slackUrlCipher), buildSlackMessage(incident, ctx));
    if (result.status < 200 || result.status >= 300) throw new Error(`Slack returned HTTP ${result.status}${result.text ? `: ${result.text}` : ''}`);
    return;
  }
  if (!emailAlertsAvailable()) throw new Error('Email delivery is not configured on this SHAPI instance (RESEND_API_KEY and ALERT_EMAIL_FROM)');
  if (!destination.emails.length) throw new Error('No email recipients');
  const message = buildEmailMessage(incident, ctx);
  const result = await postJson('https://api.resend.com/emails', {
    from: config.ALERT_EMAIL_FROM,
    to: destination.emails,
    subject: message.subject,
    text: message.text,
    html: message.html,
  }, { authorization: `Bearer ${config.RESEND_API_KEY}` });
  if (result.status < 200 || result.status >= 300) throw new Error(`Email provider returned HTTP ${result.status}${result.text ? `: ${result.text}` : ''}`);
}

/** A sample incident for the "Send test alert" button. Nothing is stored. */
export async function sendTestAlert(destination: AlertDestination): Promise<void> {
  const sample: IncidentAlertInput = {
    id: 'test',
    title: 'Test alert from SHAPI',
    description: 'This is a test. Real alerts name the customer who paid but was not provisioned.',
    severity: 'HIGH',
    status: 'DETECTED',
    detectedAt: new Date(),
    integration: { id: 'test', name: 'Stripe', type: 'STRIPE' },
    invariant: { id: 'test', name: 'Paid customers are provisioned' },
  };
  await sendToDestination(destination, sample, {
    event: 'detected',
    dashboardUrl: config.DASHBOARD_URL,
    detail: 'This is a test alert. Real alerts name the customer who paid but was not provisioned, with the Stripe event ID.',
  });
}

export async function reclaimStaleProcessingAlerts(now = new Date()): Promise<void> {
  const staleWhere = {
    status: AlertDeliveryStatus.PROCESSING,
    updatedAt: { lt: alertProcessingCutoff(now) },
  };

  await prisma.alertDelivery.updateMany({
    where: { ...staleWhere, attempts: { gte: config.ALERT_WEBHOOK_MAX_ATTEMPTS } },
    data: {
      status: AlertDeliveryStatus.FAILED,
      nextAttemptAt: now,
      lastError: STALE_PROCESSING_ERROR,
    },
  });
  await prisma.alertDelivery.updateMany({
    where: { ...staleWhere, attempts: { lt: config.ALERT_WEBHOOK_MAX_ATTEMPTS } },
    data: {
      status: AlertDeliveryStatus.RETRYING,
      nextAttemptAt: now,
      lastError: STALE_PROCESSING_ERROR,
    },
  });
}

class TerminalAlertError extends Error {}

export async function deliverPendingAlerts(now = new Date(), limit = 20): Promise<void> {
  await reclaimStaleProcessingAlerts(now);
  const pending = await prisma.alertDelivery.findMany({
    where: {
      status: { in: [AlertDeliveryStatus.PENDING, AlertDeliveryStatus.RETRYING] },
      nextAttemptAt: { lte: now },
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
    include: {
      incident: {
        include: {
          integration: { select: { id: true, name: true, type: true } },
          invariant: { select: { id: true, name: true } },
        },
      },
    },
  });

  for (const delivery of pending) {
    const claimed = await prisma.alertDelivery.updateMany({
      where: {
        id: delivery.id,
        status: { in: [AlertDeliveryStatus.PENDING, AlertDeliveryStatus.RETRYING] },
      },
      data: { status: AlertDeliveryStatus.PROCESSING, attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;

    const attempt = delivery.attempts + 1;
    const target = parseDestinationChannel(delivery.channel ?? CHANNEL);
    let destination: AlertDestination | null = null;
    try {
      if (target) {
        destination = await prisma.alertDestination.findUnique({ where: { id: target.destinationId } });
        if (!destination || !destination.enabled) throw new TerminalAlertError('Alert destination was removed or turned off');
        await sendToDestination(destination, delivery.incident, {
          event: target.event,
          dashboardUrl: config.DASHBOARD_URL,
          detail: target.event === 'detected' ? await outcomeDetail(delivery.incident) : null,
        });
        await prisma.alertDelivery.update({
          where: { id: delivery.id },
          data: { status: AlertDeliveryStatus.DELIVERED, httpStatus: 200, deliveredAt: new Date(), lastError: null },
        });
        await prisma.alertDestination.update({ where: { id: destination.id }, data: { lastDeliveredAt: new Date(), lastError: null } });
        continue;
      }
      if (!config.ALERT_WEBHOOK_URL) throw new TerminalAlertError('Alert webhook is no longer configured');
      const result = await sendAlert(delivery.incident);
      if (result.status >= 200 && result.status < 300) {
        await prisma.alertDelivery.update({
          where: { id: delivery.id },
          data: {
            status: AlertDeliveryStatus.DELIVERED,
            httpStatus: result.status,
            deliveredAt: new Date(),
            lastError: null,
          },
        });
        continue;
      }
      throw new Error(`Alert receiver returned HTTP ${result.status}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Alert delivery failed';
      const terminal = error instanceof TerminalAlertError || attempt >= config.ALERT_WEBHOOK_MAX_ATTEMPTS;
      await prisma.alertDelivery.update({
        where: { id: delivery.id },
        data: {
          status: terminal ? AlertDeliveryStatus.FAILED : AlertDeliveryStatus.RETRYING,
          nextAttemptAt: terminal ? now : nextAlertAttempt(attempt, now),
          lastError: message.slice(0, 1000),
        },
      });
      if (destination) {
        await prisma.alertDestination.update({ where: { id: destination.id }, data: { lastError: message.slice(0, 500) } }).catch(() => undefined);
      }
      logger.error(
        { alertDeliveryId: delivery.id, incidentId: delivery.incidentId, channel: delivery.channel, attempt, terminal, error: message },
        'Incident alert delivery failed',
      );
    }
  }
}
