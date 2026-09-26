import type { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma.js';
import type { Prisma} from '@prisma/client';
import { IntegrationType, WebhookEventStatus } from '@prisma/client';
import crypto from 'crypto';

function parseType(input: unknown): IntegrationType {
  const s = String(input ?? '').toUpperCase();
  if ((Object.values(IntegrationType) as string[]).includes(s)) {
    return s as IntegrationType;
  }
  return IntegrationType.CUSTOM;
}

export async function integrationRoutes(app: FastifyInstance) {
  app.get('/integrations', async (request, reply) => {
    const q = (request.query ?? {}) as Record<string, unknown>;
    const typeRaw = q.type as string | undefined;
    const page = Number(q.page ?? 1) || 1;
    const pageSize = Math.min(Number(q.pageSize ?? 20) || 20, 100);

    const where: Prisma.IntegrationWhereInput = {};
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
      data: integrations,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  });

  app.get('/integrations/:id', async (request, reply) => {
    const { id } = (request.params ?? {}) as { id: string };
    const integration = await prisma.integration.findUnique({
      where: { id },
      include: {
        webhookEvents: { take: 10, orderBy: { receivedAt: 'desc' } },
        invariants: true,
        incidents: { take: 10, orderBy: { detectedAt: 'desc' } },
      },
    });
    if (!integration) return reply.code(404).send({ error: 'Integration not found' });
    return reply.send(integration);
  });

  app.post('/integrations', async (request, reply) => {
    const data = (request.body ?? {}) as {
      name: string;
      type: string;
      config?: Record<string, unknown>;
      webhookSecret?: string;
      webhookEnabled?: boolean;
    };
    if (!data.name) return reply.code(400).send({ error: 'name is required' });

    const webhookSecret = data.webhookSecret || generateWebhookSecret();
    const integration = await prisma.integration.create({
      data: {
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

    return reply.code(201).send(integration);
  });

  app.patch('/integrations/:id', async (request, reply) => {
    const { id } = (request.params ?? {}) as { id: string };
    const data = (request.body ?? {}) as {
      name?: string;
      config?: Record<string, unknown>;
      webhookSecret?: string;
      webhookEnabled?: boolean;
    };

    const integration = await prisma.integration.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.config !== undefined ? { config: data.config as Prisma.InputJsonValue } : {}),
        ...(data.webhookSecret !== undefined ? { webhookSecret: data.webhookSecret } : {}),
        ...(data.webhookEnabled !== undefined ? { webhookEnabled: data.webhookEnabled } : {}),
      },
    });
    return reply.send(integration);
  });

  app.delete('/integrations/:id', async (request, reply) => {
    const { id } = (request.params ?? {}) as { id: string };
    await prisma.integration.delete({ where: { id } });
    return reply.code(204).send();
  });

  app.get('/integrations/:id/webhook-events', async (request, reply) => {
    const { id } = (request.params ?? {}) as { id: string };
    const q = (request.query ?? {}) as Record<string, unknown>;
    const page = Number(q.page ?? 1) || 1;
    const pageSize = Math.min(Number(q.pageSize ?? 20) || 20, 100);

    const where: Prisma.WebhookEventWhereInput = { integrationId: id };
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
    const { id } = (request.params ?? {}) as { id: string };
    const newSecret = generateWebhookSecret();
    const integration = await prisma.integration.update({
      where: { id },
      data: { webhookSecret: newSecret },
    });
    return reply.send({ webhookSecret: integration.webhookSecret });
  });

  app.get('/integrations/:id/webhook-url', async (request, reply) => {
    const { id } = (request.params ?? {}) as { id: string };
    const integration = await prisma.integration.findUnique({
      where: { id },
      select: { id: true, type: true, webhookSecret: true },
    });
    if (!integration) return reply.code(404).send({ error: 'Integration not found' });

    const baseUrl = process.env.BACKEND_URL || 'http://localhost:3001';
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
      webhookSecret: integration.webhookSecret,
      instructions: getWebhookInstructions(
        integration.type,
        webhookUrl,
        integration.webhookSecret ?? '',
      ),
    });
  });
}

function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString('hex')}`;
}

function getWebhookInstructions(type: string, url: string, secret: string): string {
  const instructions: Record<string, string> = {
    STRIPE: `1. Stripe Dashboard > Developers > Webhooks\n2. Add endpoint: ${url}\n3. Signing secret: ${secret}`,
    GITHUB: `1. GitHub App > Webhooks\n2. Payload URL: ${url}\n3. Secret: ${secret}`,
    SENDGRID: `1. SendGrid > Event Webhook\n2. URL: ${url}`,
    TWILIO: `1. Twilio Console > Webhook URL: ${url}`,
  };
  return instructions[type] || `POST to ${url} with header x-webhook-secret: ${secret}`;
}
