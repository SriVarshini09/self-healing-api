import type { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma.js';
import type { Prisma } from '@prisma/client';
import { IncidentSeverity, IncidentStatus } from '@prisma/client';
import { detectDrift } from '@shapi/drift-detection';
import { tenantIdFor } from '../utils/auth-context.js';

export async function driftRoutes(app: FastifyInstance) {
  app.get('/drift/config/:integrationId', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { integrationId } = (request.params ?? {}) as { integrationId: string };
    const integration = await prisma.integration.findFirst({ where: { id: integrationId, tenantId } });
    if (!integration) return reply.code(404).send({ error: 'Integration not found' });
    let config = await prisma.driftDetectionConfig.findUnique({ where: { integrationId } });
    if (!config) {
      config = await prisma.driftDetectionConfig.create({ data: { integrationId } });
    }
    return reply.send(config);
  });

  app.patch('/drift/config/:integrationId', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { integrationId } = (request.params ?? {}) as { integrationId: string };
    const integration = await prisma.integration.findFirst({ where: { id: integrationId, tenantId } });
    if (!integration) return reply.code(404).send({ error: 'Integration not found' });
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
    const tenantId = tenantIdFor(request);
    const q = (request.query ?? {}) as Record<string, unknown>;
    const page = Number(q.page ?? 1) || 1;
    const pageSize = Math.min(Number(q.pageSize ?? 20) || 20, 100);

    const where: Prisma.DriftResultWhereInput = { invariant: { integration: { tenantId } } };
    if (typeof q.invariantId === 'string') where.invariantId = q.invariantId;
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
    const tenantId = tenantIdFor(request);
    const { invariantId } = (request.params ?? {}) as { invariantId: string };
    const q = (request.query ?? {}) as Record<string, unknown>;
    const page = Number(q.page ?? 1) || 1;
    const pageSize = Math.min(Number(q.pageSize ?? 20) || 20, 100);

    const [results, total] = await Promise.all([
      prisma.driftResult.findMany({
        where: { invariantId, invariant: { integration: { tenantId } } },
        orderBy: { detectedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.driftResult.count({ where: { invariantId, invariant: { integration: { tenantId } } } }),
    ]);

    return reply.send({
      data: results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  });

  app.post('/drift/check/:invariantId', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { invariantId } = (request.params ?? {}) as { invariantId: string };
    const invariant = await prisma.invariant.findFirst({ where: { id: invariantId, integration: { tenantId } } });
    if (!invariant) return reply.code(404).send({ error: 'Invariant not found' });

    const config = await prisma.driftDetectionConfig.findUnique({
      where: { integrationId: invariant.integrationId },
    });
    if (!config || !config.enabled) {
      return reply.code(400).send({ error: 'Drift detection not enabled for this integration' });
    }

    const currentStart = new Date(Date.now() - config.detectionWindowHours * 60 * 60 * 1000);
    const baselineStart = new Date(Date.now() - config.baselineWindowDays * 24 * 60 * 60 * 1000);
    const baselineEvaluations = await prisma.invariantEvaluation.findMany({
      where: { invariantId, windowStart: { gte: baselineStart, lt: currentStart } },
    });
    if (baselineEvaluations.length < 10) {
      return reply.code(400).send({ error: 'Insufficient baseline data (need at least 10 evaluations)' });
    }
    const baselineSuccesses = baselineEvaluations.reduce((sum, e) => sum + e.passedSamples, 0);
    const baselineTrials = baselineEvaluations.reduce((sum, e) => sum + e.totalSamples, 0);
    const currentEvaluations = await prisma.invariantEvaluation.findMany({
      where: { invariantId, windowStart: { gte: currentStart } },
    });
    const currentSuccesses = currentEvaluations.reduce((sum, e) => sum + e.passedSamples, 0);
    const currentTrials = currentEvaluations.reduce((sum, e) => sum + e.totalSamples, 0);
    if (currentTrials < config.minDetectionSamples) {
      return reply
        .code(400)
        .send({ error: `Insufficient current data (need at least ${config.minDetectionSamples} samples)` });
    }
    const drift = detectDrift(
      { baselineSuccesses, baselineTrials, currentSuccesses, currentTrials },
      {
        minDetectionSamples: config.minDetectionSamples,
        significanceThreshold: config.significanceThreshold,
        minEffectSize: config.minEffectSize,
      },
    );

    const result = await prisma.driftResult.create({
      data: {
        invariantId,
        detected: drift.detected,
        pValue: drift.pValue,
        effectSize: drift.effectSize,
        baselineRate: drift.baselineRate,
        currentRate: drift.currentRate,
        sampleSize: currentTrials,
      },
    });

    if (drift.detected) {
      await createDriftIncident(invariantId, drift.baselineRate, drift.currentRate, drift.pValue, drift.effectSize);
    }

    return reply.send(result);
  });

  app.get('/drift/summary', async (_request, reply) => {
    const tenantId = tenantIdFor(_request);
    const [recentDetections, totalInvariants, enabledConfigs] = await Promise.all([
      prisma.driftResult.findMany({
        where: { detected: true, detectedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, invariant: { integration: { tenantId } } },
        orderBy: { detectedAt: 'desc' },
        take: 10,
        include: {
          invariant: { select: { id: true, name: true, integration: { select: { name: true } } } },
        },
      }),
      prisma.invariant.count({ where: { integration: { tenantId } } }),
      prisma.driftDetectionConfig.count({ where: { enabled: true, integration: { tenantId } } }),
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
    where: { invariantId, status: { in: [IncidentStatus.DETECTED, IncidentStatus.TRIAGED, IncidentStatus.REPLAYING] } },
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
