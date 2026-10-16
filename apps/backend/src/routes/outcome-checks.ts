import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { IntegrationType, OutcomeRunStatus, type OutcomeCheck, type Prisma } from '@prisma/client';
import {
  assertPostgresUrl,
  assertPublicDatabaseHost,
  bindParams,
  sqlParamNames,
  validateBindings,
  validateOutcomeSql,
} from '@shapi/outcome-checks';
import { blockPrivateDatabaseHosts } from '../config.js';
import { prisma } from '../utils/prisma.js';
import { tenantIdFor } from '../utils/auth-context.js';
import { decryptSecret, describeDatabaseUrl, encryptSecret } from '../utils/secrets.js';
import {
  defaultOutcomeDeps,
  deleteOutcomeInvariant,
  outcomeInvariantId,
  processDueOutcomeRuns,
  reconcileOutcomeCheck,
  syncOutcomeInvariant,
} from '../services/outcome-checks.js';
import { clampInt } from '../utils/pagination.js';

// Restricted keys (rk_) are the recommended way to connect. Secret keys are
// accepted in test mode only; a live secret key grants far more than SHAPI needs.
const stripeKeySchema = z.string().trim().regex(/^(rk_live_|rk_test_|sk_test_)[A-Za-z0-9]+$/, {
  message: 'Use a Stripe restricted key (rk_live_… / rk_test_…) with read access to Events, or a test-mode secret key',
});

const baseFields = {
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  triggerEventType: z.string().trim().min(1).max(200),
  sql: z.string().min(1).max(4000),
  paramBindings: z.record(z.string().min(1).max(200)),
  deadlineSec: z.number().int().min(30).max(86_400).optional(),
  databaseUrl: z.string().trim().min(1).max(2000),
  stripeApiKey: stripeKeySchema.nullable().optional(),
  enabled: z.boolean().optional(),
};
const createSchema = z.object({ integrationId: z.string().min(1), ...baseFields });
const updateSchema = z.object(baseFields).partial();

function publicView(check: OutcomeCheck & { _count?: unknown }) {
  const { databaseUrlCipher, stripeApiKeyCipher, sqlQuery, ...rest } = check;
  let database = 'unavailable';
  try {
    database = describeDatabaseUrl(decryptSecret(databaseUrlCipher));
  } catch {
    // undecryptable (rotated key) - shown as unavailable rather than failing the list
  }
  return {
    ...rest,
    sql: sqlQuery,
    database,
    stripeConnected: Boolean(stripeApiKeyCipher),
    invariantId: outcomeInvariantId(check.id),
  };
}

/** Validate SQL, bindings and URL together; returns an error message or the normalized SQL. */
function validateDefinition(sql: string, bindings: Record<string, string>, databaseUrl?: string): { sql: string } | { error: string } {
  try {
    const normalized = validateOutcomeSql(sql);
    validateBindings(sqlParamNames(normalized), bindings);
    if (databaseUrl !== undefined) assertPostgresUrl(databaseUrl);
    return { sql: normalized };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Hosted mode: the database must be on the public internet (see network.ts in @shapi/outcome-checks). */
async function publicHostError(databaseUrl: string | undefined): Promise<string | null> {
  if (databaseUrl === undefined || !blockPrivateDatabaseHosts()) return null;
  try {
    await assertPublicDatabaseHost(databaseUrl);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function outcomeCheckRoutes(app: FastifyInstance) {
  async function findCheck(tenantId: string, id: string) {
    return prisma.outcomeCheck.findFirst({ where: { id, integration: { tenantId } } });
  }

  app.get('/outcome-checks', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const checks = await prisma.outcomeCheck.findMany({
      where: { integration: { tenantId } },
      orderBy: { createdAt: 'desc' },
    });
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    const counts = await prisma.outcomeCheckRun.groupBy({
      by: ['checkId', 'status'],
      where: { checkId: { in: checks.map(check => check.id) }, createdAt: { gte: since } },
      _count: { _all: true },
    });
    return reply.send({
      data: checks.map(check => ({
        ...publicView(check),
        runsLast24h: Object.fromEntries(Object.values(OutcomeRunStatus).map(status => [
          status,
          counts.find(row => row.checkId === check.id && row.status === status)?._count._all ?? 0,
        ])),
      })),
    });
  });

  app.get('/outcome-checks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await findCheck(tenantIdFor(request), id);
    if (!check) return reply.code(404).send({ error: 'Outcome check not found' });
    return reply.send(publicView(check));
  });

  app.post('/outcome-checks', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const parsed = createSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid outcome check', details: parsed.error.flatten() });
    const body = parsed.data;

    const integration = await prisma.integration.findFirst({ where: { id: body.integrationId, tenantId } });
    if (!integration) return reply.code(404).send({ error: 'Integration not found' });
    if (body.stripeApiKey && integration.type !== IntegrationType.STRIPE) {
      return reply.code(400).send({ error: 'A Stripe API key can only be attached to a Stripe integration' });
    }
    const definition = validateDefinition(body.sql, body.paramBindings, body.databaseUrl);
    if ('error' in definition) return reply.code(400).send({ error: definition.error });
    const hostError = await publicHostError(body.databaseUrl);
    if (hostError) return reply.code(400).send({ error: hostError });

    const check = await prisma.outcomeCheck.create({
      data: {
        integrationId: integration.id,
        name: body.name,
        description: body.description ?? '',
        triggerEventType: body.triggerEventType,
        sqlQuery: definition.sql,
        paramBindings: body.paramBindings as Prisma.InputJsonValue,
        deadlineSec: body.deadlineSec ?? 300,
        databaseUrlCipher: encryptSecret(body.databaseUrl),
        stripeApiKeyCipher: body.stripeApiKey ? encryptSecret(body.stripeApiKey) : null,
        enabled: body.enabled ?? true,
      },
    });
    await syncOutcomeInvariant(check);
    return reply.code(201).send(publicView(check));
  });

  app.patch('/outcome-checks/:id', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { id } = request.params as { id: string };
    const existing = await findCheck(tenantId, id);
    if (!existing) return reply.code(404).send({ error: 'Outcome check not found' });
    const parsed = updateSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid outcome check', details: parsed.error.flatten() });
    const body = parsed.data;

    const sql = body.sql ?? existing.sqlQuery;
    const bindings = body.paramBindings ?? (existing.paramBindings as Record<string, string>);
    const definition = validateDefinition(sql, bindings, body.databaseUrl);
    if ('error' in definition) return reply.code(400).send({ error: definition.error });
    const hostError = await publicHostError(body.databaseUrl);
    if (hostError) return reply.code(400).send({ error: hostError });

    const data: Prisma.OutcomeCheckUpdateInput = {
      name: body.name,
      description: body.description,
      triggerEventType: body.triggerEventType,
      sqlQuery: definition.sql,
      paramBindings: bindings as Prisma.InputJsonValue,
      deadlineSec: body.deadlineSec,
      enabled: body.enabled,
    };
    if (body.databaseUrl !== undefined) data.databaseUrlCipher = encryptSecret(body.databaseUrl);
    if (body.stripeApiKey !== undefined) {
      data.stripeApiKeyCipher = body.stripeApiKey ? encryptSecret(body.stripeApiKey) : null;
      data.lastReconciledAt = null;
    }
    const check = await prisma.outcomeCheck.update({ where: { id }, data });
    await syncOutcomeInvariant(check);
    return reply.send(publicView(check));
  });

  app.delete('/outcome-checks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await findCheck(tenantIdFor(request), id);
    if (!existing) return reply.code(404).send({ error: 'Outcome check not found' });
    await prisma.outcomeCheck.delete({ where: { id } });
    await deleteOutcomeInvariant(id);
    return reply.code(204).send();
  });

  // Dry run: bind a sample event and run the query now. Nothing is stored.
  app.post('/outcome-checks/:id/test', async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await findCheck(tenantIdFor(request), id);
    if (!check) return reply.code(404).send({ error: 'Outcome check not found' });
    const event = (request.body as { event?: unknown } | undefined)?.event;
    if (!event || typeof event !== 'object') return reply.code(400).send({ error: 'Body must include an "event" object' });

    const names = sqlParamNames(check.sqlQuery);
    let params;
    try {
      params = bindParams(names, check.paramBindings as Record<string, string>, event);
    } catch (error) {
      return reply.code(422).send({ error: error instanceof Error ? error.message : String(error) });
    }
    try {
      const result = await defaultOutcomeDeps.runQuery({
        connectionString: decryptSecret(check.databaseUrlCipher),
        sql: check.sqlQuery,
        params,
        blockPrivateHosts: blockPrivateDatabaseHosts(),
      });
      return reply.send({ ...result, params: Object.fromEntries(names.map((name, index) => [name, params[index]])) });
    } catch (error) {
      return reply.code(502).send({ error: `Query failed: ${error instanceof Error ? error.message : String(error)}` });
    }
  });

  // Pull recent trigger events from Stripe and check every one now.
  app.post('/outcome-checks/:id/reconcile', async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await findCheck(tenantIdFor(request), id);
    if (!check) return reply.code(404).send({ error: 'Outcome check not found' });
    if (!check.stripeApiKeyCipher) return reply.code(400).send({ error: 'Attach a Stripe restricted key to reconcile' });
    const parsed = z.object({ sinceHours: z.number().min(1).max(720).optional() }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'sinceHours must be between 1 and 720' });

    const now = new Date();
    const sinceSec = Math.floor((now.getTime() - (parsed.data.sinceHours ?? 24) * 3_600_000) / 1000);
    try {
      const reconciled = await reconcileOutcomeCheck(check, sinceSec, now);
      const processed = await processDueOutcomeRuns(now);
      return reply.send({ ...reconciled, processed });
    } catch (error) {
      return reply.code(502).send({ error: `Stripe reconcile failed: ${error instanceof Error ? error.message : String(error)}` });
    }
  });

  app.get('/outcome-checks/:id/runs', async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await findCheck(tenantIdFor(request), id);
    if (!check) return reply.code(404).send({ error: 'Outcome check not found' });
    const q = (request.query ?? {}) as Record<string, unknown>;
    const where: Prisma.OutcomeCheckRunWhereInput = { checkId: id };
    if (typeof q.status === 'string' && (Object.values(OutcomeRunStatus) as string[]).includes(q.status)) {
      where.status = q.status as OutcomeRunStatus;
    }
    const runs = await prisma.outcomeCheckRun.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: clampInt(q.limit, 50, 1, 200),
    });
    return reply.send({ data: runs });
  });
}
