import type { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma.js';
import type { Prisma} from '@prisma/client';
import { IntegrationType, WebhookEventStatus } from '@prisma/client';
import crypto from 'crypto';
import { z } from 'zod';
import { tenantIdFor } from '../utils/auth-context.js';
import { pageParams } from '../utils/pagination.js';
import { publicApiOrigin } from '../utils/public-url.js';
import { isPlaceholderWebhookSecret } from '../services/stripe.js';

const integrationCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.string().trim().min(1),
  config: z.record(z.unknown()).optional(),
  // Providers issue long secrets (Stripe: whsec_...). Short ones are guessable, and
  // placeholder values would switch signature checking off, so they are refused in production.
  webhookSecret: z.string().min(16).max(256)
    .refine(value => process.env.NODE_ENV !== 'production' || !isPlaceholderWebhookSecret(value), 'Use the real signing secret from your provider')
    .optional(),
  webhookEnabled: z.boolean().optional(),
});

const integrationPatchSchema = integrationCreateSchema.partial().omit({ type: true });

function redactIntegration<T extends { webhookSecret?: string | null }>(integration: T) {
  const { webhookSecret, ...safe } = integration;
  return { ...safe, webhookSecretConfigured: Boolean(webhookSecret) };
}

function parseType(input: unknown): IntegrationType {
  const s = String(input ?? '').toUpperCase();
  if ((Object.values(IntegrationType) as string[]).includes(s)) {
    return s as IntegrationType;
  }
  return IntegrationType.CUSTOM;
}

export async function integrationRoutes(app: FastifyInstance) {
  app.get('/integrations', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const q = (request.query ?? {}) as Record<string, unknown>;
    const typeRaw = q.type as string | undefined;
    const { page, pageSize } = pageParams(q);

    const where: Prisma.IntegrationWhereInput = { tenantId };
    if (typeRaw) where.type = parseType(typeRaw);

    const [integrations, total] = await Promise.all([
      prisma.integration.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          _count: { select: { webhookEvents: true, invariants: true, incidents: true } },
        },
      }),
      prisma.integration.count({ where }),
    ]);

    return reply.send({
      data: integrations.map(redactIntegration),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  });

  app.get('/integrations/:id', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { id } = (request.params ?? {}) as { id: string };
    const integration = await prisma.integration.findUnique({
      where: { id, tenantId },
      include: {
        webhookEvents: { take: 10, orderBy: { receivedAt: 'desc' } },
        invariants: true,
        incidents: { take: 10, orderBy: { detectedAt: 'desc' } },
      },
    });
    if (!integration) return reply.code(404).send({ error: 'Integration not found' });
    return reply.send(redactIntegration(integration));
  });

  app.post('/integrations', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const parsed = integrationCreateSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid integration payload', details: parsed.error.flatten() });
    const data = parsed.data;

    const webhookSecret = data.webhookSecret || generateWebhookSecret();
    const integration = await prisma.integration.create({
      data: {
        tenantId,
        name: data.name,
        type: parseType(data.type),
        config: (data.config ?? {}) as Prisma.InputJsonValue,
        webhookSecret,
        webhookEnabled: data.webhookEnabled ?? true,
      },
    });

    await prisma.driftDetectionConfig.upsert({
      where: { integrationId: integration.id },
      update: {},
      create: { integrationId: integration.id },
    });

    // Webhook secrets are write-only. Callers can use the explicit
    // regenerate-secret endpoint when a provider needs a new secret; normal
    // integration creation must not echo credentials into logs or browser
    // state.
    return reply.code(201).send(redactIntegration(integration));
  });

  app.patch('/integrations/:id', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { id } = (request.params ?? {}) as { id: string };
    const parsed = integrationPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid integration payload', details: parsed.error.flatten() });
    const data = parsed.data;

    const integration = await prisma.integration.update({
      where: { id, tenantId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.config !== undefined ? { config: data.config as Prisma.InputJsonValue } : {}),
        ...(data.webhookSecret !== undefined ? { webhookSecret: data.webhookSecret } : {}),
        ...(data.webhookEnabled !== undefined ? { webhookEnabled: data.webhookEnabled } : {}),
      },
    });
    return reply.send(redactIntegration(integration));
  });

  app.delete('/integrations/:id', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { id } = (request.params ?? {}) as { id: string };
    await prisma.integration.delete({ where: { id, tenantId } });
    return reply.code(204).send();
  });

  app.get('/integrations/:id/webhook-events', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { id } = (request.params ?? {}) as { id: string };
    const q = (request.query ?? {}) as Record<string, unknown>;
    const { page, pageSize } = pageParams(q);

    const where: Prisma.WebhookEventWhereInput = { integrationId: id, integration: { tenantId } };
    if (typeof q.status === 'string' && (Object.values(WebhookEventStatus) as string[]).includes(q.status)) {
      where.status = q.status as WebhookEventStatus;
    }
    if (typeof q.eventType === 'string') where.eventType = q.eventType;

    const [events, total] = await Promise.all([
      prisma.webhookEvent.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.webhookEvent.count({ where }),
    ]);

    return reply.send({
      data: events,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  });

  app.post('/integrations/:id/regenerate-secret', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { id } = (request.params ?? {}) as { id: string };
    const newSecret = generateWebhookSecret();
    const integration = await prisma.integration.update({
      where: { id, tenantId },
      data: { webhookSecret: newSecret },
    });
    return reply.send({ webhookSecret: integration.webhookSecret });
  });

  app.get('/integrations/:id/webhook-url', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { id } = (request.params ?? {}) as { id: string };
    const integration = await prisma.integration.findUnique({
      where: { id, tenantId },
      select: { id: true, type: true, webhookSecret: true },
    });
    if (!integration) return reply.code(404).send({ error: 'Integration not found' });

    const baseUrl = publicApiOrigin(request);
    let webhookUrl: string;
    switch (integration.type) {
      case 'STRIPE':
        webhookUrl = `${baseUrl}/api/v1/webhooks/stripe`;
        break;
      case 'GITHUB':
        webhookUrl = `${baseUrl}/api/v1/webhooks/github`;
        break;
      case 'SENDGRID':
        webhookUrl = `${baseUrl}/api/v1/webhooks/sendgrid`;
        break;
      case 'TWILIO':
        webhookUrl = `${baseUrl}/api/v1/webhooks/twilio`;
        break;
      default:
        webhookUrl = `${baseUrl}/api/v1/webhooks/${integration.id}`;
    }

    return reply.send({
      webhookUrl,
      webhookSecretConfigured: Boolean(integration.webhookSecret),
      instructions: getWebhookInstructions(
        integration.type,
        webhookUrl,
      ),
    });
  });
}

function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString('hex')}`;
}

function getWebhookInstructions(type: string, url: string): string {
  const instructions: Record<string, string> = {
    STRIPE: `1. Stripe Dashboard > Developers > Webhooks\n2. Add endpoint: ${url}\n3. In Stripe, reveal the endpoint's signing secret (it starts with whsec_) and save it here so SHAPI can verify events.`,
    GITHUB: `1. GitHub App > Webhooks\n2. Payload URL: ${url}\n3. Configure the signing secret returned when this integration was created or regenerated.`,
    SENDGRID: `1. SendGrid > Event Webhook\n2. URL: ${url}`,
    TWILIO: `1. Twilio Console > Webhook URL: ${url}`,
  };
  return instructions[type] || `POST to ${url} with header x-webhook-secret using the configured integration secret.`;
}
