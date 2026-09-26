import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import crypto from 'crypto';
import type {
  Prisma} from '@prisma/client';
import {
  IncidentSeverity,
  IncidentStatus,
  WebhookEventStatus,
  IntegrationType,
} from '@prisma/client';

type WebhookRequest = FastifyRequest & { rawBody?: unknown };
import { evaluatePredicate as sandboxedEvaluate } from '@shapi/invariant-engine';

export async function webhookRoutes(app: FastifyInstance) {
  // rawBody: true opts into fastify-raw-body capture for HMAC verification.
  app.post('/webhooks/stripe', { config: { rawBody: true } }, async (request, reply) => {
    return handleStripeWebhook(request as WebhookRequest, reply);
  });

  app.post('/webhooks/github', { config: { rawBody: true } }, async (request, reply) => {
    return handleWebhook(request, reply, 'github');
  });

  app.post('/webhooks/sendgrid', async (request, reply) => {
    return handleWebhook(request, reply, 'sendgrid');
  });

  app.post('/webhooks/twilio', async (request, reply) => {
    return handleWebhook(request, reply, 'twilio');
  });

  app.post('/webhooks/:integrationId', async (request, reply) => {
    return handleGenericWebhook(request, reply);
  });
}

type WebhookKind = 'stripe' | 'github' | 'sendgrid' | 'twilio' | 'custom';

function toPrismaIntegrationType(kind: WebhookKind): IntegrationType {
  switch (kind) {
    case 'stripe':
      return IntegrationType.STRIPE;
    case 'github':
      return IntegrationType.GITHUB;
    case 'sendgrid':
      return IntegrationType.SENDGRID;
    case 'twilio':
      return IntegrationType.TWILIO;
    default:
      return IntegrationType.CUSTOM;
  }
}

async function handleStripeWebhook(request: WebhookRequest, reply: FastifyReply) {
  const headers = normalizeHeaders(request.headers ?? {});
  const rawBody: string =
    typeof request.rawBody === 'string'
      ? request.rawBody
      : JSON.stringify(request.body ?? {});

  // Find candidate integration first (secret needed for verification).
  const candidate = await prisma.integration.findFirst({
    where: { type: IntegrationType.STRIPE, webhookEnabled: true },
  });
  if (!candidate) {
    return reply.code(401).send({ error: 'Invalid webhook signature' });
  }

  let payload: Record<string, unknown>;
  try {
    const { verifyStripeWebhook } = await import('../services/stripe.js');
    const result = verifyStripeWebhook(rawBody, headers['stripe-signature'], candidate.webhookSecret ?? undefined);
    payload = result.event as unknown as Record<string, unknown>;
    if (result.verified) logger.debug('Stripe signature verified via SDK');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Stripe signature verification failed');
    return reply.code(401).send({ error: 'Invalid webhook signature' });
  }

  const eventType = (payload.type as string) || 'unknown';
  const webhookEvent = await prisma.webhookEvent.create({
    data: {
      integrationId: candidate.id,
      eventType,
      payload: payload as Prisma.InputJsonValue,
      headers: headers as Prisma.InputJsonValue,
      status: WebhookEventStatus.RECEIVED,
      correlationId: extractCorrelationId(headers, payload),
    },
  });

  processWebhookEvent(webhookEvent.id, candidate.id, eventType, payload).catch(err => {
    logger.error(err, 'Failed to process webhook event');
  });

  return reply.code(200).send({ received: true, eventId: webhookEvent.id });
}

async function handleWebhook(request: FastifyRequest, reply: FastifyReply, type: WebhookKind) {
  const headers = normalizeHeaders(request.headers ?? {});
  const payload = (request.body ?? {}) as Record<string, unknown>;
  // HMAC must run over the exact raw bytes (whitespace included); re-stringified
  // JSON would compute a different digest and reject real webhooks.
  const rawBody = (request as WebhookRequest).rawBody;
  const rawBytes = typeof rawBody === 'string' ? rawBody : undefined;
  const integration = await findIntegrationByTypeAndVerify(type, headers, payload);

  if (!integration) {
    logger.warn({ type }, 'Webhook verification failed - integration not found');
    return reply.code(401).send({ error: 'Invalid webhook signature' });
  }

  const verified = await verifyWebhookSignature(type, integration, headers, payload, rawBytes);
  if (!verified) {
    logger.warn({ integrationId: integration.id }, 'Webhook signature verification failed');
    return reply.code(401).send({ error: 'Invalid webhook signature' });
  }

  const eventType = extractEventType(type, headers, payload);

  const webhookEvent = await prisma.webhookEvent.create({
    data: {
      integrationId: integration.id,
      eventType,
      payload: payload as Prisma.InputJsonValue,
      headers: headers as Prisma.InputJsonValue,
      status: WebhookEventStatus.RECEIVED,
      correlationId: extractCorrelationId(headers, payload),
    },
  });

  processWebhookEvent(webhookEvent.id, integration.id, eventType, payload).catch(err => {
    logger.error(err, 'Failed to process webhook event');
  });

  logger.info(
    { webhookEventId: webhookEvent.id, integrationId: integration.id, eventType },
    'Webhook received',
  );
  return reply.code(200).send({ received: true, eventId: webhookEvent.id });
}

async function handleGenericWebhook(request: FastifyRequest, reply: FastifyReply) {
  const { integrationId } = (request.params ?? {}) as { integrationId: string };
  const headers = normalizeHeaders(request.headers ?? {});
  const payload = (request.body ?? {}) as Record<string, unknown>;

  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
  });

  if (!integration || !integration.webhookEnabled) {
    return reply.code(404).send({ error: 'Integration not found or webhook disabled' });
  }

  const providedSecret = headers['x-webhook-secret'];
  if (integration.webhookSecret && providedSecret !== integration.webhookSecret) {
    return reply.code(401).send({ error: 'Invalid webhook secret' });
  }

  const eventType = headers['x-event-type'] || 'unknown';

  const webhookEvent = await prisma.webhookEvent.create({
    data: {
      integrationId,
      eventType,
      payload: payload as Prisma.InputJsonValue,
      headers: headers as Prisma.InputJsonValue,
      status: WebhookEventStatus.RECEIVED,
      correlationId: headers['x-correlation-id'] || null,
    },
  });

  processWebhookEvent(webhookEvent.id, integrationId, eventType, payload).catch(err => {
    logger.error(err, 'Failed to process generic webhook event');
  });

  return reply.code(200).send({ received: true, eventId: webhookEvent.id });
}

function normalizeHeaders(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') out[k.toLowerCase()] = v;
    else if (Array.isArray(v) && typeof v[0] === 'string') out[k.toLowerCase()] = v[0];
  }
  return out;
}

async function findIntegrationByTypeAndVerify(
  type: WebhookKind,
  headers: Record<string, string>,
  _payload: Record<string, unknown>,
) {
  if (type === 'stripe') {
    if (!headers['stripe-signature']) return null;
    return prisma.integration.findFirst({
      where: { type: IntegrationType.STRIPE, webhookEnabled: true },
    });
  }

  if (type === 'github') {
    return prisma.integration.findFirst({
      where: { type: IntegrationType.GITHUB, webhookEnabled: true },
    });
  }

  return prisma.integration.findFirst({
    where: { type: toPrismaIntegrationType(type), webhookEnabled: true },
  });
}

export async function verifyWebhookSignature(
  type: WebhookKind,
  integration: { webhookSecret: string | null; id: string },
  headers: Record<string, string>,
  payload: Record<string, unknown>,
  rawBytes?: string,
): Promise<boolean> {
  if (!integration.webhookSecret) {
    logger.warn({ integrationId: integration.id }, 'No webhook secret configured');
    return false;
  }

  switch (type) {
    case 'stripe': {
      return Boolean(headers['stripe-signature']);
    }
    case 'github': {
      const signature = headers['x-hub-signature-256'];
      if (!signature) return false;
      try {
        const hmac = crypto.createHmac('sha256', integration.webhookSecret);
        hmac.update(rawBytes ?? JSON.stringify(payload));
        const expected = `sha256=${hmac.digest('hex')}`;
        if (signature.length !== expected.length) return false;
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
      } catch {
        return false;
      }
    }
    default:
      return true;
  }
}

function extractEventType(
  type: WebhookKind,
  headers: Record<string, string>,
  payload: Record<string, unknown>,
): string {
  switch (type) {
    case 'stripe':
      return (payload.type as string) || 'unknown';
    case 'github':
      return headers['x-github-event'] || (payload.action as string) || 'unknown';
    case 'sendgrid':
      return (payload.event as string) || 'unknown';
    case 'twilio':
      return (
        (payload.EventType as string) || (payload.MessageStatus as string) || 'unknown'
      );
    default:
      return 'unknown';
  }
}

function extractCorrelationId(
  headers: Record<string, string>,
  payload: Record<string, unknown>,
): string | null {
  return (
    headers['x-correlation-id'] ||
    headers['x-request-id'] ||
    (payload.correlation_id as string) ||
    (payload.request_id as string) ||
    null
  );
}

async function processWebhookEvent(
  webhookEventId: string,
  integrationId: string,
  eventType: string,
  payload: Record<string, unknown>,
) {
  await prisma.webhookEvent.update({
    where: { id: webhookEventId },
    data: { status: WebhookEventStatus.PROCESSING, processedAt: new Date() },
  });

  try {
    const { evaluateInvariantsForEvent } = await import('../services/invariants.js');
    const evaluated = await evaluateInvariantsForEvent(integrationId, eventType, payload);

    for (const invariantId of evaluated) {
      await checkDrift(invariantId);
    }

    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { status: WebhookEventStatus.COMPLETED },
    });

    logger.debug({ webhookEventId }, 'Webhook event processed successfully');
  } catch (error) {
    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: {
        status: WebhookEventStatus.FAILED,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    throw error;
  }
}

export function evaluatePredicate(
  expression: string,
  context: { event: { type: string; payload: Record<string, unknown>; headers: Record<string, unknown> } },
): boolean {
  // Sandboxed evaluation shared with @shapi/invariant-engine (node:vm, 100ms timeout).
  return sandboxedEvaluate(expression, context.event).passed;
}

async function checkDrift(invariantId: string) {
  const invariant = await prisma.invariant.findUnique({ where: { id: invariantId } });
  if (!invariant) return;
  const config = await prisma.driftDetectionConfig.findUnique({
    where: { integrationId: invariant.integrationId },
  });

  if (!config || !config.enabled) return;

  const baselineStart = new Date(Date.now() - config.baselineWindowDays * 24 * 60 * 60 * 1000);
  const baselineEvaluations = await prisma.invariantEvaluation.findMany({
    where: { invariantId, windowStart: { gte: baselineStart } },
  });

  if (baselineEvaluations.length < 10) return;

  const baselineRate =
    baselineEvaluations.reduce((sum, e) => sum + e.successRate, 0) / baselineEvaluations.length;

  const currentStart = new Date(Date.now() - config.detectionWindowHours * 60 * 60 * 1000);
  const currentEvaluations = await prisma.invariantEvaluation.findMany({
    where: { invariantId, windowStart: { gte: currentStart } },
  });

  if (currentEvaluations.length < config.minDetectionSamples) return;

  const currentRate =
    currentEvaluations.reduce((sum, e) => sum + e.successRate, 0) / currentEvaluations.length;

  const { pValue, effectSize } = performProportionTest(
    currentEvaluations.reduce((sum, e) => sum + e.passedSamples, 0),
    currentEvaluations.reduce((sum, e) => sum + e.totalSamples, 0),
    baselineRate,
  );

  const detected =
    pValue < config.significanceThreshold && Math.abs(effectSize) >= config.minEffectSize;

  await prisma.driftResult.create({
    data: {
      invariantId,
      detected,
      pValue,
      effectSize,
      baselineRate,
      currentRate,
      sampleSize: currentEvaluations.reduce((sum, e) => sum + e.totalSamples, 0),
    },
  });

  if (detected) {
    await createDriftIncident(invariantId, baselineRate, currentRate, pValue, effectSize);
  }
}

export function performProportionTest(successes: number, trials: number, baselineRate: number) {
  if (trials === 0) return { pValue: 1, effectSize: 0 };
  const currentRate = successes / trials;
  const pooledRate = (successes + baselineRate * trials) / (trials + trials);
  const se = Math.sqrt(pooledRate * (1 - pooledRate) * (2 / trials));
  const z = se === 0 ? 0 : (currentRate - baselineRate) / se;
  const pValue = 2 * (1 - normalCDF(Math.abs(z)));
  const denom = Math.sqrt(Math.max(baselineRate * (1 - baselineRate), 1e-9));
  const effectSize = (currentRate - baselineRate) / denom;
  return { pValue, effectSize };
}

export function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * x);
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const prob =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - prob : prob;
}

async function createDriftIncident(
  invariantId: string,
  baselineRate: number,
  currentRate: number,
  pValue: number,
  effectSize: number,
) {
  const invariant = await prisma.invariant.findUnique({
    where: { id: invariantId },
  });

  if (!invariant) return;

  const existingIncident = await prisma.incident.findFirst({
    where: {
      invariantId,
      status: { in: [IncidentStatus.DETECTED, IncidentStatus.TRIAGED, IncidentStatus.REPLAYING] },
    },
  });

  if (existingIncident) return;

  const severity =
    Math.abs(effectSize) > 1
      ? IncidentSeverity.CRITICAL
      : Math.abs(effectSize) > 0.8
        ? IncidentSeverity.HIGH
        : IncidentSeverity.MEDIUM;

  await prisma.incident.create({
    data: {
      integrationId: invariant.integrationId,
      invariantId,
      title: `Behavioral drift detected: ${invariant.name}`,
      description: `Invariant "${invariant.name}" success rate dropped from ${(baselineRate * 100).toFixed(1)}% to ${(currentRate * 100).toFixed(1)}% (p=${pValue.toFixed(4)}, effect size=${effectSize.toFixed(2)})`,
      severity,
      status: IncidentStatus.DETECTED,
    },
  });
}
