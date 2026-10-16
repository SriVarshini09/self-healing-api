import { AlertDeliveryStatus, AlertDestinationKind, type AlertDestination } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { tenantIdFor } from '../utils/auth-context.js';
import { prisma } from '../utils/prisma.js';
import { encryptSecret } from '../utils/secrets.js';
import { isEmail, isSlackWebhookUrl } from '../services/alerts-core.js';
import { emailAlertsAvailable, sendTestAlert } from '../services/alerts.js';

const emailsSchema = z.array(z.string().trim().toLowerCase()).min(1).max(10)
  .refine(list => list.every(isEmail), { message: 'Enter valid email addresses' });
const slackUrlSchema = z.string().trim().refine(isSlackWebhookUrl, {
  message: 'Use a Slack incoming webhook URL (https://hooks.slack.com/services/...)',
});

const createSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('SLACK'),
    name: z.string().trim().min(1).max(80),
    slackWebhookUrl: slackUrlSchema,
    notifyResolved: z.boolean().optional(),
  }).strict(),
  z.object({
    kind: z.literal('EMAIL'),
    name: z.string().trim().min(1).max(80),
    emails: emailsSchema,
    notifyResolved: z.boolean().optional(),
  }).strict(),
]);

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
  notifyResolved: z.boolean().optional(),
  slackWebhookUrl: slackUrlSchema.optional(),
  emails: emailsSchema.optional(),
}).strict();

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid alert destination';
}

/** Never return the Slack URL (or internal tenant id); only whether one is configured. */
function view(destination: AlertDestination) {
  return {
    id: destination.id,
    kind: destination.kind,
    name: destination.name,
    emails: destination.emails,
    enabled: destination.enabled,
    notifyResolved: destination.notifyResolved,
    slackConfigured: Boolean(destination.slackUrlCipher),
    lastDeliveredAt: destination.lastDeliveredAt,
    lastError: destination.lastError,
    createdAt: destination.createdAt,
    updatedAt: destination.updatedAt,
  };
}

export async function alertRoutes(app: FastifyInstance) {
  app.get('/alerts/status', async request => {
    const tenantId = tenantIdFor(request);
    const where = { incident: { integration: { tenantId } } };
    const [pending, processing, retrying, delivered, failed, destinations] = await Promise.all([
      prisma.alertDelivery.count({ where: { ...where, status: AlertDeliveryStatus.PENDING } }),
      prisma.alertDelivery.count({ where: { ...where, status: AlertDeliveryStatus.PROCESSING } }),
      prisma.alertDelivery.count({ where: { ...where, status: AlertDeliveryStatus.RETRYING } }),
      prisma.alertDelivery.count({ where: { ...where, status: AlertDeliveryStatus.DELIVERED } }),
      prisma.alertDelivery.count({ where: { ...where, status: AlertDeliveryStatus.FAILED } }),
      prisma.alertDestination.count({ where: { tenantId, enabled: true } }),
    ]);
    return { webhookConfigured: Boolean(config.ALERT_WEBHOOK_URL), destinations, pending, processing, retrying, delivered, failed };
  });

  app.get('/alerts/destinations', async request => {
    const tenantId = tenantIdFor(request);
    const destinations = await prisma.alertDestination.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
    return { data: destinations.map(view), emailAvailable: emailAlertsAvailable() };
  });

  app.post('/alerts/destinations', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const parsed = createSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
    const body = parsed.data;
    if (body.kind === 'EMAIL' && !emailAlertsAvailable()) {
      return reply.code(400).send({ error: 'Email alerts are not configured on this SHAPI instance yet. Use Slack, or ask the operator to set RESEND_API_KEY and ALERT_EMAIL_FROM.' });
    }
    const count = await prisma.alertDestination.count({ where: { tenantId } });
    if (count >= 20) return reply.code(400).send({ error: 'A workspace can have up to 20 alert destinations' });
    const destination = await prisma.alertDestination.create({
      data: {
        tenantId,
        kind: body.kind === 'SLACK' ? AlertDestinationKind.SLACK : AlertDestinationKind.EMAIL,
        name: body.name,
        slackUrlCipher: body.kind === 'SLACK' ? encryptSecret(body.slackWebhookUrl) : null,
        emails: body.kind === 'EMAIL' ? [...new Set(body.emails)] : [],
        notifyResolved: body.notifyResolved ?? true,
      },
    });
    return reply.code(201).send(view(destination));
  });

  app.patch('/alerts/destinations/:id', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { id } = request.params as { id: string };
    const existing = await prisma.alertDestination.findFirst({ where: { id, tenantId } });
    if (!existing) return reply.code(404).send({ error: 'Alert destination not found' });
    const parsed = patchSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
    const body = parsed.data;
    if (body.slackWebhookUrl && existing.kind !== AlertDestinationKind.SLACK) return reply.code(400).send({ error: 'Not a Slack destination' });
    if (body.emails && existing.kind !== AlertDestinationKind.EMAIL) return reply.code(400).send({ error: 'Not an email destination' });
    const destination = await prisma.alertDestination.update({
      where: { id },
      data: {
        name: body.name,
        enabled: body.enabled,
        notifyResolved: body.notifyResolved,
        ...(body.slackWebhookUrl ? { slackUrlCipher: encryptSecret(body.slackWebhookUrl), lastError: null } : {}),
        ...(body.emails ? { emails: [...new Set(body.emails)], lastError: null } : {}),
      },
    });
    return reply.send(view(destination));
  });

  app.delete('/alerts/destinations/:id', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { id } = request.params as { id: string };
    const deleted = await prisma.alertDestination.deleteMany({ where: { id, tenantId } });
    if (!deleted.count) return reply.code(404).send({ error: 'Alert destination not found' });
    return reply.code(204).send();
  });

  // Sends a clearly labeled sample alert right away. Nothing is stored.
  app.post('/alerts/destinations/:id/test', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { id } = request.params as { id: string };
    const destination = await prisma.alertDestination.findFirst({ where: { id, tenantId } });
    if (!destination) return reply.code(404).send({ error: 'Alert destination not found' });
    // A setup problem on this instance, not a failure of the provider: say so with a 409.
    if (destination.kind === 'EMAIL' && !emailAlertsAvailable()) {
      return reply.code(409).send({ error: 'Email alerts are not configured on this SHAPI instance yet. Use Slack, or ask the operator to set RESEND_API_KEY and ALERT_EMAIL_FROM.' });
    }
    try {
      await sendTestAlert(destination);
      await prisma.alertDestination.update({ where: { id }, data: { lastDeliveredAt: new Date(), lastError: null } });
      return reply.send({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Test alert failed';
      await prisma.alertDestination.update({ where: { id }, data: { lastError: message.slice(0, 500) } });
      return reply.code(502).send({ error: message });
    }
  });
}
