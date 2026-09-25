import type { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma.js';

export async function sdkRoutes(app: FastifyInstance) {
  // SDK track endpoint - stores TrackedEvent, no auth for local MVP (API key validated loosely)
  app.post('/sdk/track', async (request, reply) => {
    const body = (request.body ?? {}) as {
      eventId: string;
      integration: string;
      type: string;
      payload?: Record<string, unknown>;
      timestamp?: string;
      correlationId?: string;
      metadata?: Record<string, unknown>;
    };

    if (!body.eventId || !body.integration || !body.type) {
      return reply.code(400).send({ error: 'eventId, integration, type required' });
    }

    const integrationType = String(body.integration).toUpperCase() as any;

    try {
      const tracked = await prisma.trackedEvent.upsert({
        where: { eventId: body.eventId },
        update: {},
        create: {
          eventId: body.eventId,
          integration: integrationType,
          type: body.type,
          payload: (body.payload ?? {}) as any,
          timestamp: body.timestamp ? new Date(body.timestamp) : new Date(),
          correlationId: body.correlationId,
          metadata: (body.metadata ?? {}) as any,
        },
      });

      // Behavioral evaluation: tracked business outcomes feed the same
      // invariant engine as webhooks, so a `provisioning.failed` flips its
      // invariant even though the HTTP layer returned 200 everywhere.
      const integration = await prisma.integration.findFirst({
        where: { type: integrationType, webhookEnabled: true },
      });
      if (integration) {
        const { evaluateInvariantsForEvent } = await import('../services/invariants.js');
        await evaluateInvariantsForEvent(
          integration.id,
          body.type,
          (body.payload ?? {}) as Record<string, unknown>,
          {},
        );
      }

      return reply.code(201).send({ ok: true, id: tracked.id });
    } catch (e) {
      return reply.code(500).send({ error: 'Failed to store event' });
    }
  });

  app.get('/sdk/events', async (request, reply) => {
    const q = (request.query ?? {}) as Record<string, unknown>;
    const page = Number(q.page ?? 1) || 1;
    const pageSize = Math.min(Number(q.pageSize ?? 20) || 20, 100);
    const where: any = {};
    if (q.integration) where.integration = String(q.integration).toUpperCase();
    if (q.type) where.type = q.type;
    if (q.correlationId) where.correlationId = q.correlationId;

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
