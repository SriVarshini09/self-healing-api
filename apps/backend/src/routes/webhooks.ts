import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { queueIncidentAlert } from '../services/alert-queue.js';
import { observeStripeEvent } from '../services/stripe-changes.js';
import { isPlaceholderWebhookSecret } from '../services/stripe.js';
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
import { detectDrift, driftSeverity } from '@shapi/drift-detection';
import { publicApiOrigin } from '../utils/public-url.js';

export async function webhookRoutes(app: FastifyInstance) {
  // rawBody: true opts into fastify-raw-body capture for HMAC verification.
  app.post('/webhooks/stripe', { config: { rawBody: true } }, async (request, reply) => {
    return handleStripeWebhook(request as WebhookRequest, reply);
  });

  app.post('/webhooks/github', { config: { rawBody: true } }, async (request, reply) => {
    return handleWebhook(request, reply, 'github');
  });

  app.post('/webhooks/sendgrid', { config: { rawBody: true } }, async (request, reply) => {
    return handleWebhook(request, reply, 'sendgrid');
  });

  app.post('/webhooks/twilio', { config: { rawBody: true } }, async (request, reply) => {
    return handleWebhook(request, reply, 'twilio');
  });

  app.post('/webhooks/:integrationId', async (request, reply) => {
    return handleGenericWebhook(request, reply);
  });
}

type WebhookKind = 'stripe' | 'github' | 'sendgrid' | 'twilio' | 'custom';

const isDevSecret = isPlaceholderWebhookSecret;

/**
 * Signing secrets to try for one Stripe integration, in order. A real STRIPE_WEBHOOK_SECRET
 * in the environment is a single-deployment convenience, so it is tried first only while
 * there is exactly one integration. The integration's own secret is ALWAYS tried too:
 * a leftover env value must never make a tenant's correctly configured secret stop working
 * (before, its events started failing signature checks the moment it was the only
 * integration, and recovered when a second one appeared).
 */
export function stripeSecretsToTry(
  integrationSecret: string | null,
  envSecret: string | undefined,
  candidateCount: number,
): Array<string | undefined> {
  const secrets: Array<string | undefined> = [];
  if (envSecret && !isDevSecret(envSecret) && candidateCount === 1) secrets.push(envSecret);
  const own = integrationSecret ?? undefined;
  if (!secrets.includes(own)) secrets.push(own);
  return secrets;
}

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

  // A provider endpoint can serve multiple tenant integrations. Verify against
  // each configured candidate and only persist the event for the integration
  // whose secret actually authenticated the request.
  const candidates = await prisma.integration.findMany({
    where: { type: IntegrationType.STRIPE, webhookEnabled: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!candidates.length || !headers['stripe-signature']) {
    return reply.code(401).send({ error: 'Invalid webhook signature' });
  }
  if (process.env.NODE_ENV === 'production' && headers['stripe-signature'] === 'test') {
    return reply.code(401).send({ error: 'Test webhook signatures are disabled in production' });
  }

  // A real STRIPE_WEBHOOK_SECRET in the environment is a convenient
  // single-integration deployment override. With multiple tenants, each
  // candidate must be checked against its own stored secret so a global env
  // secret cannot route an event into the wrong tenant.
  const envSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const { verifyStripeWebhook } = await import('../services/stripe.js');
  let candidate: (typeof candidates)[number] | undefined;
  let payload: Record<string, unknown> | undefined;
  // Local-dev only (never in production, see verifyStripeWebhook): an integration
  // with a placeholder secret accepts unsigned events. It may only claim an event
  // when no integration's real signature matched, otherwise it would swallow
  // other tenants' genuine events just by being earlier in the list.
  let unverified: { integration: (typeof candidates)[number]; payload: Record<string, unknown> } | undefined;
  verification: for (const integration of candidates) {
    for (const secret of stripeSecretsToTry(integration.webhookSecret, envSecret, candidates.length)) {
      try {
        const result = verifyStripeWebhook(rawBody, headers['stripe-signature'], secret);
        if (result.verified) {
          candidate = integration;
          payload = result.event as unknown as Record<string, unknown>;
          logger.debug({ integrationId: integration.id }, 'Stripe signature verified via SDK');
          break verification;
        }
        unverified ??= { integration, payload: result.event as unknown as Record<string, unknown> };
      } catch (err) {
        logger.debug({ integrationId: integration.id, err: err instanceof Error ? err.message : String(err) }, 'Stripe candidate did not verify');
      }
    }
  }
  if (!candidate && unverified) {
    candidate = unverified.integration;
    payload = unverified.payload;
  }
  if (!candidate || !payload) {
    logger.warn('Stripe webhook verification failed for all configured integrations');
    return reply.code(401).send({ error: 'Invalid webhook signature' });
  }

  const eventType = (payload.type as string) || 'unknown';
  const providerEventId = typeof payload.id === 'string' ? payload.id : null;
  const existing = providerEventId
    ? await prisma.webhookEvent.findFirst({ where: { integrationId: candidate.id, providerEventId } })
    : null;
  if (existing) return reply.code(200).send({ received: true, eventId: existing.id, duplicate: true });
  const webhookEvent = await prisma.webhookEvent.create({
    data: {
      integrationId: candidate.id,
      eventType,
      providerEventId,
      payload: payload as Prisma.InputJsonValue,
      headers: headers as Prisma.InputJsonValue,
      status: WebhookEventStatus.RECEIVED,
      correlationId: extractCorrelationId(headers, payload),
    },
  });

  processWebhookEvent(webhookEvent.id, candidate.id, eventType, payload).catch(err => {
    logger.error(err, 'Failed to process webhook event');
  });
  // Stripe change monitor (API version, fields removed or retyped). Never throws.
  void observeStripeEvent(candidate.id, payload);

  return reply.code(200).send({ received: true, eventId: webhookEvent.id });
}

async function handleWebhook(request: FastifyRequest, reply: FastifyReply, type: WebhookKind) {
  const headers = normalizeHeaders(request.headers ?? {});
  const payload = (request.body ?? {}) as Record<string, unknown>;
  // HMAC must run over the exact raw bytes (whitespace included); re-stringified
  // JSON would compute a different digest and reject real webhooks.
  const rawBody = (request as WebhookRequest).rawBody;
  const rawBytes = typeof rawBody === 'string' ? rawBody : undefined;
  const webhookUrl = `${publicApiOrigin(request)}${request.raw.url ?? request.url}`;
  const candidates = await findIntegrationsByType(type);
  let integration: (typeof candidates)[number] | undefined;
  for (const candidate of candidates) {
    if (await verifyWebhookSignature(type, candidate, headers, payload, rawBytes, webhookUrl)) {
      integration = candidate;
      break;
    }
  }

  if (!integration) {
    logger.warn({ type }, 'Webhook verification failed - integration not found');
    return reply.code(401).send({ error: 'Invalid webhook signature' });
  }

  const eventType = extractEventType(type, headers, payload);
  const providerEventId = providerEventIdFor(type, headers, payload);
  const existing = providerEventId
    ? await prisma.webhookEvent.findFirst({ where: { integrationId: integration.id, providerEventId } })
    : null;
  if (existing) return reply.code(200).send({ received: true, eventId: existing.id, duplicate: true });

  const webhookEvent = await prisma.webhookEvent.create({
    data: {
      integrationId: integration.id,
      eventType,
      providerEventId,
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

  const verified = await verifyWebhookSignature('custom', integration, headers, payload);
  if (!verified) {
    return reply.code(401).send({ error: 'Invalid webhook secret' });
  }

  const eventType = headers['x-event-type'] || 'unknown';
  const providerEventId = providerEventIdFor('custom', headers, payload);
  const existing = providerEventId
    ? await prisma.webhookEvent.findFirst({ where: { integrationId, providerEventId } })
    : null;
  if (existing) return reply.code(200).send({ received: true, eventId: existing.id, duplicate: true });

  const webhookEvent = await prisma.webhookEvent.create({
    data: {
      integrationId,
      eventType,
      providerEventId,
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

async function findIntegrationsByType(
  type: WebhookKind,
) {
  return prisma.integration.findMany({
    where: { type: toPrismaIntegrationType(type), webhookEnabled: true },
  });
}

export async function verifyWebhookSignature(
  type: WebhookKind,
  integration: { webhookSecret: string | null; id: string; config?: unknown },
  headers: Record<string, string>,
  payload: Record<string, unknown>,
  rawBytes?: string,
  webhookUrl?: string,
): Promise<boolean> {
  if (!integration.webhookSecret && type !== 'sendgrid') {
    logger.warn({ integrationId: integration.id }, 'No webhook secret configured');
    return false;
  }

  switch (type) {
    case 'stripe': {
      return Boolean(headers['stripe-signature']);
    }
    case 'github': {
      const signature = headers['x-hub-signature-256'];
      const secret = integration.webhookSecret;
      if (!signature || !secret) return false;
      try {
        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(rawBytes ?? JSON.stringify(payload));
        const expected = `sha256=${hmac.digest('hex')}`;
        if (signature.length !== expected.length) return false;
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
      } catch {
        return false;
      }
    }
    case 'sendgrid': {
      const config = integration.config && typeof integration.config === 'object'
        ? integration.config as Record<string, unknown>
        : {};
      const publicKey = typeof config.sendgridPublicKey === 'string'
        ? config.sendgridPublicKey
        : typeof config.publicKey === 'string' ? config.publicKey : undefined;
      const signature = headers['x-twilio-email-event-webhook-signature'];
      const timestamp = headers['x-twilio-email-event-webhook-timestamp'];
      if (!publicKey || !signature || !timestamp || !rawBytes) return false;
      try {
        return crypto.verify(
          'sha256',
          Buffer.from(`${timestamp}${rawBytes}`, 'utf8'),
          crypto.createPublicKey(publicKey),
          Buffer.from(signature, 'base64'),
        );
      } catch {
        return false;
      }
    }
    case 'twilio': {
      const signature = headers['x-twilio-signature'];
      const secret = integration.webhookSecret;
      if (!signature || !webhookUrl || !secret) return false;
      const params = Object.entries(payload)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}${String(value)}`)
        .join('');
      const expected = crypto.createHmac('sha1', secret)
        .update(`${webhookUrl}${params}`)
        .digest('base64');
      const actual = Buffer.from(signature);
      const expectedBuffer = Buffer.from(expected);
      return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
    }
    case 'custom': {
      const provided = headers['x-webhook-secret'];
      const secret = integration.webhookSecret;
      if (!provided || !secret) return false;
      const expected = Buffer.from(secret);
      const actual = Buffer.from(provided);
      return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    }
  }
}

function providerEventIdFor(
  type: WebhookKind,
  headers: Record<string, string>,
  payload: Record<string, unknown>,
): string | null {
  if (type === 'github') return headers['x-github-delivery'] || null;
  if (type === 'stripe') return typeof payload.id === 'string' ? payload.id : null;
  return headers['x-event-id'] || (typeof payload.id === 'string' ? payload.id : null);
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

export async function processWebhookEvent(
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

    // Queue outcome checks triggered by this event. A queueing failure must not
    // fail webhook processing; the Stripe reconcile pass will pick the event up.
    const { enqueueOutcomeRuns } = await import('../services/outcome-checks.js');
    const sourceEventId = typeof payload.id === 'string' && payload.id ? payload.id : webhookEventId;
    await enqueueOutcomeRuns(integrationId, eventType, sourceEventId, payload, new Date(), 'WEBHOOK')
      .catch(error => logger.error({ webhookEventId, error }, 'Failed to queue outcome checks'));

    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { status: WebhookEventStatus.COMPLETED },
    });

    logger.debug({ webhookEventId }, 'Webhook event processed successfully');
  } catch (error) {
    // The event can be gone already (its workspace was deleted mid-processing);
    // still report the original failure rather than the follow-up one.
    await prisma.webhookEvent.updateMany({
      where: { id: webhookEventId },
      data: {
        status: WebhookEventStatus.FAILED,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    throw error;
  }
}

export async function recoverPendingWebhookEvents(): Promise<void> {
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
  // An event that crashed mid-processing five times is never retried again. Mark it
  // FAILED so it stops looking "in progress" forever (and stops tripping self-monitoring).
  await prisma.webhookEvent.updateMany({
    where: {
      retryCount: { gte: 5 },
      OR: [
        { status: WebhookEventStatus.PROCESSING, processedAt: { lt: staleBefore } },
        { status: WebhookEventStatus.RETRYING, receivedAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } },
      ],
    },
    data: { status: WebhookEventStatus.FAILED, errorMessage: 'Gave up after repeated processing attempts' },
  });
  const events = await prisma.webhookEvent.findMany({
    where: {
      retryCount: { lt: 5 },
      OR: [
        { status: WebhookEventStatus.RECEIVED },
        { status: WebhookEventStatus.RETRYING },
        { status: WebhookEventStatus.FAILED },
        { status: WebhookEventStatus.PROCESSING, processedAt: { lt: staleBefore } },
      ],
    },
    orderBy: { receivedAt: 'asc' },
    take: 100,
  });

  for (const event of events) {
    const claimed = await prisma.webhookEvent.updateMany({
      where: { id: event.id, status: event.status, retryCount: event.retryCount },
      data: { status: WebhookEventStatus.RETRYING, retryCount: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;
    await processWebhookEvent(
      event.id,
      event.integrationId,
      event.eventType,
      (event.payload ?? {}) as Record<string, unknown>,
    ).catch(error => logger.error({ error, webhookEventId: event.id }, 'Webhook recovery failed'));
  }
}

export function evaluatePredicate(
  expression: string,
  context: { event: { type: string; payload: Record<string, unknown>; headers: Record<string, unknown> } },
): boolean {
  // Sandboxed evaluation shared with @shapi/invariant-engine (isolated-vm, 100ms timeout).
  return sandboxedEvaluate(expression, context.event).passed;
}

export async function checkDrift(invariantId: string) {
  const invariant = await prisma.invariant.findUnique({ where: { id: invariantId } });
  if (!invariant) return;
  const config = await prisma.driftDetectionConfig.findUnique({
    where: { integrationId: invariant.integrationId },
  });

  if (!config || !config.enabled) return;

  const currentStart = new Date(Date.now() - config.detectionWindowHours * 60 * 60 * 1000);
  const baselineStart = new Date(Date.now() - config.baselineWindowDays * 24 * 60 * 60 * 1000);
  const baselineEvaluations = await prisma.invariantEvaluation.findMany({
    where: { invariantId, windowStart: { gte: baselineStart, lt: currentStart } },
  });

  const baselineSuccesses = baselineEvaluations.reduce((sum, e) => sum + e.passedSamples, 0);
  const baselineTrials = baselineEvaluations.reduce((sum, e) => sum + e.totalSamples, 0);
  if (baselineTrials === 0) return;

  const currentEvaluations = await prisma.invariantEvaluation.findMany({
    where: { invariantId, windowStart: { gte: currentStart } },
  });

  const currentSuccesses = currentEvaluations.reduce((sum, e) => sum + e.passedSamples, 0);
  const currentTrials = currentEvaluations.reduce((sum, e) => sum + e.totalSamples, 0);
  if (currentTrials < config.minDetectionSamples) return;

  const result = detectDrift(
    { baselineSuccesses, baselineTrials, currentSuccesses, currentTrials },
    {
      minDetectionSamples: config.minDetectionSamples,
      significanceThreshold: config.significanceThreshold,
      minEffectSize: config.minEffectSize,
    },
  );

  // Evaluate on every pass so a regression that starts mid-window is caught within minutes,
  // not at the next window. Only an already-reported regression suppresses a new one, and
  // healthy results are sampled (not stored on every pass) to keep history small.
  const reported = await prisma.driftResult.findFirst({
    where: { invariantId, detected: true, detectedAt: { gte: currentStart } },
  });
  if (reported) return;
  if (!result.detected) {
    const sampled = await prisma.driftResult.findFirst({
      where: { invariantId, detectedAt: { gte: new Date(Date.now() - HEALTHY_SAMPLE_INTERVAL_MS) } },
    });
    if (sampled) return;
  }

  await prisma.driftResult.create({
    data: {
      invariantId,
      detected: result.detected,
      pValue: result.pValue,
      effectSize: result.effectSize,
      baselineRate: result.baselineRate,
      currentRate: result.currentRate,
      sampleSize: currentTrials,
    },
  });

  if (result.detected) {
    await createDriftIncident(invariantId, result.baselineRate, result.currentRate, result.pValue, result.effectSize);
  }
}

/** A healthy drift result is stored at most this often per invariant. */
const HEALTHY_SAMPLE_INTERVAL_MS = 15 * 60 * 1000;

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

  const severity = IncidentSeverity[driftSeverity(baselineRate, currentRate)];

  const incident = await prisma.incident.create({
    data: {
      integrationId: invariant.integrationId,
      invariantId,
      title: `Behavioral drift detected: ${invariant.name}`,
      description: `Invariant "${invariant.name}" success rate dropped from ${(baselineRate * 100).toFixed(1)}% to ${(currentRate * 100).toFixed(1)}% (p=${pValue.toFixed(4)}, effect size=${effectSize.toFixed(2)})`,
      severity,
      status: IncidentStatus.DETECTED,
    },
  });
  await queueIncidentAlert(incident.id);
}
