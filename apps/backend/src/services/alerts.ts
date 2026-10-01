import { AlertDeliveryStatus } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { buildIncidentAlertPayload, nextAlertAttempt, signAlertBody, type IncidentAlertInput } from './alerts-core.js';

const CHANNEL = 'webhook';

export async function enqueueIncidentAlert(incidentId: string): Promise<void> {
  if (!config.ALERT_WEBHOOK_URL) return;
  await prisma.alertDelivery.upsert({
    where: { incidentId_channel: { incidentId, channel: CHANNEL } },
    create: { incidentId, channel: CHANNEL },
    update: {},
  });
}

async function sendAlert(incident: IncidentAlertInput): Promise<{ status: number }> {
  if (!config.ALERT_WEBHOOK_URL || !config.ALERT_WEBHOOK_SECRET) {
    throw new Error('Alert webhook is not configured with a signing secret');
  }
  const body = JSON.stringify(buildIncidentAlertPayload(incident));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.ALERT_WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(config.ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'SHAPI-alert-delivery/1.0',
        'x-shapi-alert-event': 'incident.detected',
        'x-shapi-alert-signature': signAlertBody(body, config.ALERT_WEBHOOK_SECRET),
      },
      body,
      signal: controller.signal,
    });
    return { status: response.status };
  } finally {
    clearTimeout(timeout);
  }
}

export async function deliverPendingAlerts(now = new Date(), limit = 20): Promise<void> {
  if (!config.ALERT_WEBHOOK_URL) return;
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
    try {
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
      const terminal = attempt >= config.ALERT_WEBHOOK_MAX_ATTEMPTS;
      await prisma.alertDelivery.update({
        where: { id: delivery.id },
        data: {
          status: terminal ? AlertDeliveryStatus.FAILED : AlertDeliveryStatus.RETRYING,
          nextAttemptAt: terminal ? now : nextAlertAttempt(attempt, now),
          lastError: message.slice(0, 1000),
        },
      });
      logger.error(
        { alertDeliveryId: delivery.id, incidentId: delivery.incidentId, attempt, terminal, error: message },
        'Incident alert delivery failed',
      );
    }
  }
}
