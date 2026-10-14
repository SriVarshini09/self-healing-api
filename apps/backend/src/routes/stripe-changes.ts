import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tenantIdFor } from '../utils/auth-context.js';
import { prisma } from '../utils/prisma.js';
import { describeChange } from '../services/stripe-changes.js';

const querySchema = z.object({
  incidentId: z.string().min(1).max(100).optional(),
  integrationId: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function stripeChangeRoutes(app: FastifyInstance) {
  // What changed in Stripe's webhooks, newest first, with the outcome checks each change touches.
  app.get('/stripe-changes', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const parsed = querySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid query' });
    const { incidentId, integrationId, limit } = parsed.data;

    const [changes, integrations] = await Promise.all([
      prisma.stripeChange.findMany({
        where: { integration: { tenantId }, ...(incidentId ? { incidentId } : {}), ...(integrationId ? { integrationId } : {}) },
        orderBy: { detectedAt: 'desc' },
        take: limit ?? 50,
        include: { integration: { select: { id: true, name: true } } },
      }),
      prisma.integration.findMany({
        where: { tenantId, type: 'STRIPE' },
        select: { id: true, name: true, providerApiVersion: true },
      }),
    ]);
    const checkIds = [...new Set(changes.flatMap(change => change.affectedCheckIds))];
    const checks = checkIds.length
      ? await prisma.outcomeCheck.findMany({ where: { id: { in: checkIds }, integration: { tenantId } }, select: { id: true, name: true } })
      : [];
    const checksById = new Map(checks.map(check => [check.id, check]));

    return {
      data: changes.map(change => {
        const affectedChecks = change.affectedCheckIds.map(id => checksById.get(id)).filter((check): check is { id: string; name: string } => Boolean(check));
        return {
          id: change.id,
          kind: change.kind,
          eventType: change.eventType,
          path: change.path,
          before: change.before,
          after: change.after,
          apiVersion: change.apiVersion,
          sourceEventId: change.sourceEventId,
          incidentId: change.incidentId,
          integration: change.integration,
          affectedChecks,
          summary: describeChange(change, affectedChecks),
          detectedAt: change.detectedAt,
        };
      }),
      // Current API version per Stripe connection (null until a webhook arrives).
      apiVersions: integrations.map(integration => ({ integrationId: integration.id, name: integration.name, apiVersion: integration.providerApiVersion })),
    };
  });
}
