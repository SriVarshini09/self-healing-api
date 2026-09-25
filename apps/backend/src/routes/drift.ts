import type { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { performProportionTest } from './webhooks.js';

export async function driftRoutes(app: FastifyInstance) {
  app.get('/drift/config/:integrationId', async (request, reply) => {
    const { integrationId } = (request.params ?? {}) as { integrationId: string };
    let config = await prisma.driftDetectionConfig.findUnique({ where: { integrationId } });
    if (!config) {
      config = await prisma.driftDetectionConfig.create({ data: { integrationId } });
    }
    return reply.send(config);
  });

  app.patch('/drift/config/:integrationId', async (request, reply) => {
    const { integrationId } = (request.params ?? {}) as { integrationId: string };
    const data = (request.body ?? {}) as Partial<{
      baselineWindowDays: number;
      detectionWindowHours: number;
      minDetectionSamples: number;
      significanceThreshold: number;
      minEffectSize: number;
      enabled: boolean;
    }>;
    const config = await prisma.driftDetectionConfig.upsert({
      where: { integrationId },
      update: data,
      create: { integrationId, ...data },
    });
    return reply.send(config);
  });

  app.get('/drift/results', async (request, reply) => {
    const q = (request.query ?? {}) as Record<string, unknown>;
    const page = Number(q.page ?? 1) || 1;
    const pageSize = Math.min(Number(q.pageSize ?? 20) || 20, 100);

    const where: any = {};
    if (q.invariantId) where.invariantId = q.invariantId;
    if (q.detected !== undefined) where.detected = q.detected === true || q.detected === 'true';

    const [results, total] = await Promise.all([
      prisma.driftResult.findMany({
        where,
        orderBy: { detectedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { invariant: { select: { id: true, name: true, integrationId: true } } },
      }),
      prisma.driftResult.count({ where }),
    ]);

    return reply.send({
      data: results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  });

  app.get('/drift/results/:invariantId', async (request, reply) => {
    const { invariantId } = (request.params ?? {}) as { invariantId: string };
    const q = (request.query ?? {}) as Record<string, unknown>;
    const page = Number(q.page ?? 1) || 1;
    const pageSize = Math.min(Number(q.pageSize ?? 20) || 20, 100);

    const [results, total] = await Promise.all([
      prisma.driftResult.findMany({
        where: { invariantId },
        orderBy: { detectedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.driftResult.count({ where: { invariantId } }),
    ]);

    return reply.send({
      data: results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  });

  app.post('/drift/check/:invariantId', async (request, reply) => {
    const { invariantId } = (request.params ?? {}) as { invariantId: string };
    const invariant = await prisma.invariant.findUnique({ where: { id: invariantId } });
    if (!invariant) return reply.code(404).send({ error: 'Invariant not found' });

    const config = await prisma.driftDetectionConfig.findUnique({
      where: { integrationId: invariant.integrationId },
    });
    if (!config || !config.enabled) {
      return reply.code(400).send({ error: 'Drift detection not enabled for this integration' });
    }

    const baselineStart = new Date(Date.now() - config.baselineWindowDays * 24 * 60 * 60 * 1000);
    const baselineEvaluations = await prisma.invariantEvaluation.findMany({
      where: { invariantId, windowStart: { gte: baselineStart } },
    });
    if (baselineEvaluations.length < 10) {
      return reply.code(400).send({ error: 'Insufficient baseline data (need at least 10 evaluations)' });
    }
    const baselineRate =
      baselineEvaluations.reduce((sum, e) => sum + e.successRate, 0) / baselineEvaluations.length;

    const currentStart = new Date(Date.now() - config.detectionWindowHours * 60 * 60 * 1000);
    const currentEvaluations = await prisma.invariantEvaluation.findMany({
      where: { invariantId, windowStart: { gte: currentStart } },
    });
    if (currentEvaluations.length < config.minDetectionSamples) {
      return reply
        .code(400)
        .send({ error: `Insufficient current data (need at least ${config.minDetectionSamples} samples)` });
    }
    const currentRate =
      currentEvaluations.reduce((sum, e) => sum + e.successRate, 0) / currentEvaluations.length;

    const { pValue, effectSize } = performProportionTest(
      currentEvaluations.reduce((sum, e) => sum + e.passedSamples, 0),
      currentEvaluations.reduce((sum, e) => sum + e.totalSamples, 0),
      baselineRate,
    );

    const detected =
      pValue < config.significanceThreshold && Math.abs(effectSize) >= config.minEffectSize;

    const result = await prisma.driftResult.create({
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

    return reply.send(result);
  });

  app.get('/drift/summary', async (_request, reply) => {
    const [recentDetections, totalInvariants, enabledConfigs] = await Promise.all([
      prisma.driftResult.findMany({
        where: { detected: true, detectedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        orderBy: { detectedAt: 'desc' },
        take: 10,
        include: {
          invariant: { select: { id: true, name: true, integration: { select: { name: true } } } },
        },
      }),
      prisma.invariant.count(),
      prisma.driftDetectionConfig.count({ where: { enabled: true } }),
    ]);

    return reply.send({
      recentDetections,
      totalInvariants,
      monitoredIntegrations: enabledConfigs,
      activeAlerts: recentDetections.length,
    });
  });
}

async function createDriftIncident(
  invariantId: string,
  baselineRate: number,
  currentRate: number,
  pValue: number,
  effectSize: number,
) {
  const invariant = await prisma.invariant.findUnique({ where: { id: invariantId } });
  if (!invariant) return;

  const existingIncident = await prisma.incident.findFirst({
    where: { invariantId, status: { in: ['DETECTED', 'TRIAGED', 'REPLAYING'] as any } },
  });
  if (existingIncident) return;

  const severity =
    Math.abs(effectSize) > 1 ? 'CRITICAL' : Math.abs(effectSize) > 0.8 ? 'HIGH' : 'MEDIUM';

  await prisma.incident.create({
    data: {
      integrationId: invariant.integrationId,
      invariantId,
      title: `Behavioral drift detected: ${invariant.name}`,
      description: `Invariant "${invariant.name}" success rate dropped from ${(baselineRate * 100).toFixed(1)}% to ${(currentRate * 100).toFixed(1)}% (p=${pValue.toFixed(4)}, effect size=${effectSize.toFixed(2)})`,
      severity: severity as any,
      status: 'DETECTED' as any,
    },
  });
}
