import { AlertDeliveryStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { tenantIdFor } from '../utils/auth-context.js';
import { prisma } from '../utils/prisma.js';

export async function alertRoutes(app: FastifyInstance) {
  app.get('/alerts/status', async request => {
    const tenantId = tenantIdFor(request);
    const where = { incident: { integration: { tenantId } } };
    const [pending, retrying, delivered, failed] = await Promise.all([
      prisma.alertDelivery.count({ where: { ...where, status: AlertDeliveryStatus.PENDING } }),
      prisma.alertDelivery.count({ where: { ...where, status: AlertDeliveryStatus.RETRYING } }),
      prisma.alertDelivery.count({ where: { ...where, status: AlertDeliveryStatus.DELIVERED } }),
      prisma.alertDelivery.count({ where: { ...where, status: AlertDeliveryStatus.FAILED } }),
    ]);
    return { webhookConfigured: Boolean(config.ALERT_WEBHOOK_URL), pending, retrying, delivered, failed };
  });
}
