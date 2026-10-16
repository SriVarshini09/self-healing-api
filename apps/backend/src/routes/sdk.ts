import type { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma.js';
import type { Prisma } from '@prisma/client';
import { IntegrationType } from '@prisma/client';
import { z } from 'zod';
import { tenantIdFor } from '../utils/auth-context.js';
import { pageParams } from '../utils/pagination.js';

const trackSchema = z.object({
  eventId: z.string().trim().min(1).max(200),
  integration: z.string().trim().min(1),
  type: z.string().trim().min(1).max(200),
  payload: z.record(z.unknown()).default({}),
  timestamp: z.string().datetime({ offset: true }).optional(),
  correlationId: z.string().max(200).optional(),
  metadata: z.record(z.unknown()).optional(),
});

function parseIntegrationType(input: unknown): IntegrationType {
  const s = String(input ?? '').toUpperCase();
  if ((Object.values(IntegrationType) as string[]).includes(s)) return s as IntegrationType;
  throw new Error(`Unknown integration type: ${String(input)}`);
}

export async function sdkRoutes(app: FastifyInstance) {
  // SDK track endpoint - stores TrackedEvent, no auth for local MVP (API key validated loosely)
  app.post('/sdk/track', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const parsed = trackSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid tracked event payload', details: parsed.error.flatten() });
    const body = parsed.data;

    let integrationType: IntegrationType;
    try {
      integrationType = parseIntegrationType(body.integration);
    } catch {
      return reply.code(400).send({ error: 'Unknown integration type' });
    }

    try {
      const tracked = await prisma.trackedEvent.upsert({
        where: { tenantId_eventId: { tenantId, eventId: body.eventId } },
        update: {},
        create: {
          eventId: body.eventId,
          tenantId,
          integration: integrationType,
          type: body.type,
          payload: (body.payload ?? {}) as Prisma.InputJsonValue,
          timestamp: body.timestamp ? new Date(body.timestamp) : new Date(),
          correlationId: body.correlationId,
          metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });

      // Behavioral evaluation: tracked business outcomes feed the same
      // invariant engine as webhooks, so an outcome-specific failure flips
      // its invariant even though the HTTP layer returned 200 everywhere.
      const integration = await prisma.integration.findFirst({
        where: { type: integrationType, webhookEnabled: true, tenantId },
      });
      if (integration) {
        const { evaluateInvariantsForEvent } = await import('../services/invariants.js');
        await evaluateInvariantsForEvent(
          integration.id,
          body.type,
          body.payload ?? {},
          {},
        );
      }

      return reply.code(201).send({ ok: true, id: tracked.id });
    } catch (e) {
      return reply.code(500).send({ error: 'Failed to store event' });
    }
  });

  app.get('/sdk/events', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const q = (request.query ?? {}) as Record<string, unknown>;
    const { page, pageSize } = pageParams(q);
    const where: Prisma.TrackedEventWhereInput = { tenantId };
    if (typeof q.integration === 'string') {
      const s = q.integration.toUpperCase();
      if ((Object.values(IntegrationType) as string[]).includes(s)) {
        where.integration = s as IntegrationType;
      }
    }
    if (typeof q.type === 'string') where.type = q.type;
    if (typeof q.correlationId === 'string') where.correlationId = q.correlationId;

    const [data, total] = await Promise.all([
      prisma.trackedEvent.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.trackedEvent.count({ where }),
    ]);
    return reply.send({ data, pagination: { page, pageSize, total } });
  });
}
