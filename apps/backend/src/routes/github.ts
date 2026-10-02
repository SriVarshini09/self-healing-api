import type { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { GitHubPRStatus, IncidentStatus, IntegrationType, Prisma, WebhookEventStatus } from '@prisma/client';
import crypto from 'crypto';
import { z } from 'zod';
import { tenantIdFor } from '../utils/auth-context.js';
import { hasGitHubAppConfiguration, hasGitHubAppCredentials, listInstallationRepositories } from '@shapi/github-integration';

type JsonRecord = Record<string, unknown>;

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function obj(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null ? (value as JsonRecord) : {};
}

function missingRequiredChecks(
  requiredChecks: string[],
  checkRuns: Array<{ name: string; status: string | null; conclusion: string | null }>,
): string[] {
  return requiredChecks.filter(required => !checkRuns.some(run =>
    run.name === required && run.status === 'completed' && run.conclusion === 'success'
  ));
}

const TOKEN_INSTALLATION_GITHUB_ID = BigInt(-1);

async function ensureTokenInstallation(tenantId: string, integrationId: string) {
  const repositories = (process.env.GITHUB_REPOSITORIES ?? '')
    .split(',')
    .map(repository => repository.trim())
    .filter(Boolean);
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_ACCOUNT_LOGIN || repositories.length === 0) return null;

  return prisma.gitHubInstallation.upsert({
    where: { githubInstallationId: TOKEN_INSTALLATION_GITHUB_ID },
    update: { accountLogin: process.env.GITHUB_ACCOUNT_LOGIN, accountType: 'User', repositories, integrationId },
    create: {
      githubInstallationId: TOKEN_INSTALLATION_GITHUB_ID,
      accountLogin: process.env.GITHUB_ACCOUNT_LOGIN,
      accountType: 'User',
      repositories,
      integrationId,
    },
  });
}

const prSchema = z.object({
  installationId: z.string().min(1),
  repository: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
  candidateId: z.string().uuid(),
  branchName: z.string().regex(/^[A-Za-z0-9._/-]+$/).optional(),
  base: z.string().regex(/^[A-Za-z0-9._/-]+$/).optional(),
  title: z.string().trim().min(1).max(256),
  body: z.string().max(100_000).optional(),
  previewToken: z.string().min(1).max(4096).optional(),
}).strict();
const prPreviewSchema = prSchema.pick({ installationId: true, repository: true, candidateId: true, base: true }).strict();
const installationSyncSchema = z.object({ githubInstallationId: z.coerce.number().int().positive() }).strict();

const repairPreviewApprovalSchema = z.object({
  tenantId: z.string().min(1),
  incidentId: z.string().min(1),
  candidateId: z.string().uuid(),
  installationId: z.string().min(1),
  repository: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
  base: z.string().regex(/^[A-Za-z0-9._/-]+$/),
  baseSha: z.string().min(1).max(200),
  expiresAt: z.number().int().positive(),
}).strict();
type RepairPreviewApproval = z.infer<typeof repairPreviewApprovalSchema>;
const REPAIR_PREVIEW_APPROVAL_TTL_SECONDS = 5 * 60;

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signRepairPreview(encoded: string): string {
  // Application startup requires JWT_SECRET. The webhook fallback keeps this
  // pure route module testable without loading process-validating config.
  const secret = process.env.JWT_SECRET || process.env.GITHUB_WEBHOOK_SECRET_APP || '';
  return crypto.createHmac('sha256', secret).update(`repair-preview-v1.${encoded}`).digest('base64url');
}

function issueRepairPreviewToken(approval: Omit<RepairPreviewApproval, 'expiresAt'>): string {
  const encoded = Buffer.from(JSON.stringify({
    ...approval,
    expiresAt: Math.floor(Date.now() / 1000) + REPAIR_PREVIEW_APPROVAL_TTL_SECONDS,
  })).toString('base64url');
  return `${encoded}.${signRepairPreview(encoded)}`;
}

function readRepairPreviewToken(token: string): RepairPreviewApproval | null {
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra || !sameSecret(signature, signRepairPreview(encoded))) return null;
  try {
    const parsed = repairPreviewApprovalSchema.safeParse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')));
    return parsed.success && parsed.data.expiresAt >= Math.floor(Date.now() / 1000) ? parsed.data : null;
  } catch {
    return null;
  }
}

const repairChangesSchema = z.array(z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('replace'), path: z.string().min(1).max(400), before: z.string().min(1).max(100_000), after: z.string().max(100_000) }).strict(),
  z.object({ kind: z.literal('create'), path: z.string().min(1).max(400), content: z.string().max(100_000) }).strict(),
])).min(1).max(50);

function previewExcerpt(content: string, changeStart: number, changeLength: number) {
  const from = Math.max(0, changeStart - 120);
  const to = Math.min(content.length, changeStart + Math.min(changeLength, 4_000) + 120);
  return { text: content.slice(from, to), truncated: from > 0 || to < content.length };
}

export async function githubRoutes(app: FastifyInstance) {
  app.post('/github/webhook', { config: { rawBody: true } }, async (request, reply) => {
    const rawHeaders = (request.headers ?? {}) as Record<string, unknown>;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawHeaders)) {
      if (typeof v === 'string') headers[k.toLowerCase()] = v;
    }
    const payload = (request.body ?? {}) as Record<string, unknown>;
    const event = headers['x-github-event'];
    const delivery = headers['x-github-delivery'];

    const configuredIntegrationId = process.env.GITHUB_APP_INTEGRATION_ID;
    const candidates = await prisma.integration.findMany({
      where: { type: IntegrationType.GITHUB, webhookEnabled: true },
    });
    const integration = configuredIntegrationId
      ? candidates.find(candidate => candidate.id === configuredIntegrationId)
      : candidates.length === 1 ? candidates[0] : undefined;
    if (!integration) {
      return reply.code(503).send({ error: 'GitHub App integration is not configured unambiguously' });
    }

    const integrationConfig = integration.config && typeof integration.config === 'object'
      ? integration.config as Record<string, unknown>
      : {};

    const signature = headers['x-hub-signature-256'];
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET_APP
      || (typeof integrationConfig.appWebhookSecret === 'string' ? integrationConfig.appWebhookSecret : undefined)
      || integration.webhookSecret;

    if (!webhookSecret || !signature) {
      return reply.code(401).send({ error: 'GitHub webhook signature is not configured' });
    }

    if (webhookSecret && signature) {
      try {
        // HMAC over the exact raw bytes; re-stringified JSON would mismatch.
        const raw = (request as unknown as { rawBody?: unknown }).rawBody;
        const hmac = crypto.createHmac('sha256', webhookSecret);
        hmac.update(typeof raw === 'string' ? raw : JSON.stringify(payload));
        const expected = `sha256=${hmac.digest('hex')}`;
        if (
          signature.length !== expected.length ||
          !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
        ) {
          return reply.code(401).send({ error: 'Invalid signature' });
        }
      } catch {
        return reply.code(401).send({ error: 'Invalid signature' });
      }
    }

    const existing = delivery
      ? await prisma.webhookEvent.findFirst({ where: { integrationId: integration.id, providerEventId: delivery } })
      : null;
    if (existing) return reply.send({ received: true, delivery, eventId: existing.id, duplicate: true });

    let webhookEvent;
    try {
      webhookEvent = await prisma.webhookEvent.create({
        data: {
          integrationId: integration.id,
          eventType: event || 'unknown',
          providerEventId: delivery || null,
          payload: payload as Prisma.InputJsonValue,
          headers: headers as Prisma.InputJsonValue,
          status: WebhookEventStatus.RECEIVED,
        },
      });
    } catch (error) {
      // The delivery id is unique per integration. If two retries race before
      // either can be observed by findFirst, let the unique constraint turn
      // the second request into the same safe duplicate acknowledgment.
      if (delivery && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await prisma.webhookEvent.findFirst({
          where: { integrationId: integration.id, providerEventId: delivery },
        });
        if (raced) return reply.send({ received: true, delivery, eventId: raced.id, duplicate: true });
      }
      throw error;
    }

    try {
      if (event === 'installation') await handleInstallationEvent(payload, integration.id);
      if (event === 'pull_request') await handlePullRequestEvent(payload, integration.id);
      if (event === 'push') await handlePushEvent(payload);
      if (event === 'workflow_run') await handleWorkflowRunEvent(payload, integration.id);

      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: WebhookEventStatus.COMPLETED, processedAt: new Date() },
      });
    } catch (error) {
      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          status: WebhookEventStatus.FAILED,
          processedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : 'GitHub webhook processing failed',
        },
      });
      throw error;
    }

    return reply.send({ received: true, delivery, eventId: webhookEvent.id });
  });

  app.get('/github/installations', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    let installations = await prisma.gitHubInstallation.findMany({
      where: { integration: { tenantId } },
      orderBy: { createdAt: 'desc' },
      include: {
        integration: { select: { id: true, name: true } },
        _count: { select: { prs: true } },
      },
    });
    if (installations.length === 0) {
      const integration = await prisma.integration.findFirst({ where: { type: IntegrationType.GITHUB, tenantId } });
      if (integration) {
        const tokenInstallation = await ensureTokenInstallation(tenantId, integration.id);
        if (tokenInstallation) installations = [tokenInstallation as typeof installations[number]];
      }
    }
    return reply.send(installations);
  });

  app.post('/github/installations/sync', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const parsed = installationSyncSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'githubInstallationId must be a positive integer' });
    if (!hasGitHubAppCredentials(parsed.data.githubInstallationId)) {
      return reply.code(503).send({ error: 'GitHub App credentials are required to sync an installation' });
    }

    const integrationId = process.env.GITHUB_APP_INTEGRATION_ID;
    const integration = integrationId
      ? await prisma.integration.findFirst({ where: { id: integrationId, tenantId, type: IntegrationType.GITHUB } })
      : await prisma.integration.findFirst({ where: { tenantId, type: IntegrationType.GITHUB } });
    if (!integration) return reply.code(404).send({ error: 'GitHub integration not found' });

    let access;
    try {
      access = await listInstallationRepositories(parsed.data.githubInstallationId);
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : 'GitHub installation sync failed' });
    }

    const installation = await prisma.gitHubInstallation.upsert({
      where: { githubInstallationId: BigInt(parsed.data.githubInstallationId) },
      update: {
        accountLogin: access.accountLogin,
        accountType: access.accountType,
        repositories: access.repositories,
        integrationId: integration.id,
      },
      create: {
        githubInstallationId: BigInt(parsed.data.githubInstallationId),
        accountLogin: access.accountLogin,
        accountType: access.accountType,
        repositories: access.repositories,
        integrationId: integration.id,
      },
    });
    return reply.send(installation);
  });

  app.get('/github/installations/:installationId', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { installationId } = (request.params ?? {}) as { installationId: string };
    const installation = await prisma.gitHubInstallation.findFirst({
      where: { id: installationId, integration: { tenantId } },
      include: {
        integration: { select: { id: true, name: true, type: true, webhookEnabled: true } },
        prs: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!installation) return reply.code(404).send({ error: 'Installation not found' });
    return reply.send(installation);
  });

  app.get('/github/status', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const integrations = await prisma.integration.findMany({
      where: { type: IntegrationType.GITHUB, tenantId, webhookEnabled: true },
      select: { id: true, webhookSecret: true },
    });
    const integrationIds = integrations.map(integration => integration.id);
    const installations = integrationIds.length === 0
      ? []
      : await prisma.gitHubInstallation.findMany({
        where: { integrationId: { in: integrationIds } },
        select: { githubInstallationId: true, repositories: true },
      });
    const repositories = new Set(installations.flatMap(installation => installation.repositories));
    const appCredentialsConfigured = hasGitHubAppConfiguration();
    const tokenConfigured = Boolean(
      process.env.GITHUB_TOKEN &&
      process.env.GITHUB_ACCOUNT_LOGIN &&
      process.env.GITHUB_REPOSITORIES?.split(',').some(repository => repository.trim()),
    );
    const realInstallations = installations.filter(installation => Number(installation.githubInstallationId) > 0).length;
    const webhookConfigured = Boolean(
      process.env.GITHUB_WEBHOOK_SECRET_APP ||
      integrations.some(integration => Boolean(integration.webhookSecret)),
    );
    const mode = realInstallations > 0 && appCredentialsConfigured
      ? 'app'
      : tokenConfigured
        ? 'token'
        : process.env.NODE_ENV === 'production'
          ? 'unconfigured'
          : 'simulated';
    const message = mode === 'app'
      ? 'GitHub App installation authentication is ready.'
      : mode === 'token'
        ? 'Operator token mode is active for the configured repository allow-list.'
        : mode === 'simulated'
          ? 'Development simulation is active; real PRs require GitHub credentials.'
          : 'Configure a GitHub App installation or an operator token before creating real PRs.';
    const appSlug = process.env.GITHUB_APP_SLUG?.trim();

    return reply.send({
      mode,
      message,
      appCredentialsConfigured,
      tokenConfigured,
      webhookConfigured,
      realInstallations,
      installationCount: installations.length,
      repositoryCount: repositories.size,
      appInstallUrl: appSlug ? `https://github.com/apps/${appSlug}/installations/new` : null,
    });
  });

  app.get('/github/incidents/:incidentId/prs', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { incidentId } = (request.params ?? {}) as { incidentId: string };
    const prs = await prisma.gitHubPullRequest.findMany({
      where: { incidentId, incident: { integration: { tenantId } } },
      orderBy: { createdAt: 'desc' },
      include: { installation: true },
    });
    return reply.send(prs.map(pr => ({
      ...pr,
      proof: pr.verificationHeadSha && Array.isArray(pr.verificationChecks)
        ? {
            headSha: pr.verificationHeadSha,
            checksTotal: pr.verificationChecks.length,
            checkRuns: pr.verificationChecks,
          }
        : null,
    })));
  });

  app.post('/github/incidents/:incidentId/pr/preview', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { incidentId } = (request.params ?? {}) as { incidentId: string };
    const parsed = prPreviewSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid repair preview payload', details: parsed.error.flatten() });
    const { installationId, repository, candidateId, base } = parsed.data;

    let installation = await prisma.gitHubInstallation.findFirst({
      where: { id: installationId, integration: { tenantId } },
    });
    if (!installation && installationId === 'env-token-installation') {
      const integration = await prisma.integration.findFirst({ where: { type: IntegrationType.GITHUB, tenantId } });
      if (integration) installation = await ensureTokenInstallation(tenantId, integration.id);
    }
    if (!installation) return reply.code(404).send({ error: 'Installation not found' });

    const incident = await prisma.incident.findUnique({
      where: { id: incidentId, integration: { tenantId } },
      include: {
        repairCandidates: { where: { id: candidateId }, take: 1 },
        invariant: { select: { repairRequiredChecks: true } },
      },
    });
    if (!incident) return reply.code(404).send({ error: 'Incident not found' });
    const candidate = incident.repairCandidates[0];
    if (!candidate) return reply.code(404).send({ error: 'Repair candidate not found for this incident' });
    const changes = repairChangesSchema.safeParse(candidate.changes);
    if (!changes.success) return reply.code(409).send({ error: 'Selected repair candidate has no applicable file changes' });
    if (candidate.repository && (incident.invariant?.repairRequiredChecks ?? []).length === 0) {
      return reply.code(409).send({ error: 'Mapped repair targets must configure at least one required GitHub check before preview' });
    }

    const fullRepo = repository.includes('/') ? repository : `${installation.accountLogin}/${repository}`;
    if (candidate.repository !== fullRepo) return reply.code(409).send({ error: 'Repair candidate is not mapped to the selected repository' });
    if (!installation.repositories.includes(fullRepo)) return reply.code(403).send({ error: 'Repository is not included in this GitHub installation' });
    const hasAppAuth = hasGitHubAppCredentials(Number(installation.githubInstallationId));
    if (!process.env.GITHUB_TOKEN && !hasAppAuth) {
      return reply.code(503).send({ error: 'GitHub credentials are required to preview a real repository patch' });
    }

    const { previewRepairPrChanges, RepairChangeError } = await import('@shapi/github-integration');
    try {
      const preview = await previewRepairPrChanges({
        repository: fullRepo,
        ...(base ? { base } : {}),
        changes: changes.data,
      }, undefined, undefined, Number(installation.githubInstallationId));
      return reply.send({
        repository: fullRepo,
        base: preview.base,
        baseSha: preview.baseSha,
        previewToken: issueRepairPreviewToken({
          tenantId,
          incidentId,
          candidateId,
          installationId: installation.id,
          repository: fullRepo,
          base: preview.base,
          baseSha: preview.baseSha,
        }),
        changes: preview.files.map((file, index) => {
          const change = changes.data[index];
          if (change.kind === 'create') {
            return { path: file.path, kind: file.kind, before: null, after: previewExcerpt(file.content, 0, file.content.length) };
          }
          const original = file.original ?? '';
          const offset = original.indexOf(change.before);
          return {
            path: file.path,
            kind: file.kind,
            before: previewExcerpt(original, offset, change.before.length),
            after: previewExcerpt(file.content, offset, change.after.length),
          };
        }),
      });
    } catch (error) {
      if (error instanceof RepairChangeError) return reply.code(409).send({ error: error.message });
      return reply.code(502).send({ error: error instanceof Error ? error.message : 'GitHub preview failed' });
    }
  });

  app.post('/github/incidents/:incidentId/pr', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { incidentId } = (request.params ?? {}) as { incidentId: string };
    const parsed = prSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid pull-request payload', details: parsed.error.flatten() });
    const { installationId, repository, candidateId, branchName, base, title, body, previewToken } = parsed.data;

    let installation = await prisma.gitHubInstallation.findFirst({
      where: { id: installationId, integration: { tenantId } },
    });
    if (!installation && installationId === 'env-token-installation') {
      const integration = await prisma.integration.findFirst({ where: { type: IntegrationType.GITHUB, tenantId } });
      if (integration) installation = await ensureTokenInstallation(tenantId, integration.id);
    }
    if (!installation) return reply.code(404).send({ error: 'Installation not found' });

    const incident = await prisma.incident.findUnique({
      where: { id: incidentId, integration: { tenantId } },
      include: {
        repairCandidates: { where: { id: candidateId }, take: 1 },
        invariant: { select: { repairRequiredChecks: true } },
      },
    });
    if (!incident) return reply.code(404).send({ error: 'Incident not found' });
    if (incident.status === IncidentStatus.RESOLVED || incident.status === IncidentStatus.DISMISSED) {
      return reply.code(409).send({ error: 'Resolved or dismissed incidents cannot create new repair PRs' });
    }
    const candidate = incident.repairCandidates[0];
    if (!candidate) return reply.code(404).send({ error: 'Repair candidate not found for this incident' });
    const changes = repairChangesSchema.safeParse(candidate.changes);
    if (!changes.success) return reply.code(409).send({ error: 'Selected repair candidate has no applicable file changes; review it manually' });

    const hasAppAuth = hasGitHubAppCredentials(Number(installation.githubInstallationId));
    if (!process.env.GITHUB_TOKEN && !hasAppAuth) {
      return reply.code(503).send({ error: 'GitHub token or App installation credentials are required to create real repair PRs' });
    }

    const { openRepairPrFromChanges, buildRepairBranch, buildPrBody, RepairChangeError } = await import('@shapi/github-integration');
    const branch = branchName || `${buildRepairBranch(incidentId)}-${candidateId.slice(0, 8)}`;
    const prBody =
      body ||
      buildPrBody({
        incidentTitle: incident.title,
        rootCause: incident.rootCause ?? 'pending diagnosis',
        suggestedFix: candidate.description,
        confidence: candidate.confidence,
      });
    const fullRepo = repository.includes('/')
      ? repository
      : `${installation.accountLogin}/${repository}`;
    if (candidate.repository !== fullRepo) {
      return reply.code(409).send({ error: 'Repair candidate is not mapped to the selected repository' });
    }
    if (!installation.repositories.includes(fullRepo)) {
      return reply.code(403).send({ error: 'Repository is not included in this GitHub installation' });
    }
    if (candidate.repository && (incident.invariant?.repairRequiredChecks ?? []).length === 0) {
      return reply.code(409).send({ error: 'Mapped repair targets must configure at least one required GitHub check before creating a PR' });
    }
    const approval = previewToken ? readRepairPreviewToken(previewToken) : null;
    if (!approval) {
      return reply.code(409).send({ error: 'A current repair preview approval is required before creating a PR' });
    }
    if (
      approval.tenantId !== tenantId ||
      approval.incidentId !== incidentId ||
      approval.candidateId !== candidateId ||
      approval.installationId !== installation.id ||
      approval.repository !== fullRepo ||
      approval.base !== (base ?? approval.base)
    ) {
      return reply.code(409).send({ error: 'Repair preview approval does not match this PR request' });
    }
    let opened;
    try {
      opened = await openRepairPrFromChanges({
        repository: fullRepo,
        title,
        body: `${prBody}${candidate.diff ? `\n\nProposed change:\n\`\`\`diff\n${candidate.diff}\n\`\`\`` : ''}`,
        branch,
        base: approval.base,
        expectedBaseSha: approval.baseSha,
        changes: changes.data,
      }, undefined, undefined, Number(installation.githubInstallationId));
    } catch (error) {
      if (error instanceof RepairChangeError) return reply.code(409).send({ error: error.message });
      return reply.code(502).send({ error: error instanceof Error ? error.message : 'GitHub PR creation failed' });
    }
    const { prNumber, prUrl } = opened;

    const pr = await prisma.gitHubPullRequest.create({
      data: { incidentId, installationId, repository: fullRepo, prNumber, prUrl, title, status: GitHubPRStatus.OPEN },
    });

    await prisma.incident.update({
      where: { id: incidentId },
      data: { githubPrUrl: prUrl, status: IncidentStatus.REPAIRED },
    });

    return reply.code(201).send(pr);
  });

  app.post('/github/prs/:prId/verify', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { prId } = (request.params ?? {}) as { prId: string };
    const pr = await prisma.gitHubPullRequest.findFirst({
      where: { id: prId, incident: { integration: { tenantId } } },
      include: {
        incident: { include: { invariant: { select: { repairRequiredChecks: true } } } },
        installation: true,
      },
    });
    if (!pr) return reply.code(404).send({ error: 'PR not found' });

    // Verification reads the actual GitHub state. CI passing marks the PR
    // verified; a real merged/closed state also synchronizes local lifecycle
    // state when webhook delivery is unavailable (for example, local token mode).
    const { verifyRepairPr } = await import('@shapi/github-integration');
    let result;
    try {
      const installationId = Number(pr.installation?.githubInstallationId);
      result = Number.isSafeInteger(installationId) && installationId > 0
        ? await verifyRepairPr(pr.repository, pr.prNumber, undefined, undefined, installationId)
        : await verifyRepairPr(pr.repository, pr.prNumber);
    } catch (e) {
      return reply.code(502).send({ error: e instanceof Error ? e.message : 'GitHub verification failed' });
    }

    const requiredChecks = pr.incident.invariant?.repairRequiredChecks ?? [];
    const missingChecks = missingRequiredChecks(requiredChecks, result.checkRuns ?? []);
    const verified = result.verified && missingChecks.length === 0;

    const status = result.merged
      ? GitHubPRStatus.MERGED
      : result.closed
        ? GitHubPRStatus.CLOSED
        : pr.status;
    const updated = await prisma.gitHubPullRequest.update({
      where: { id: prId },
      data: {
        verified,
        status,
        verificationHeadSha: result.headSha,
        verificationChecks: result.checkRuns,
        verifiedAt: verified ? new Date() : null,
      },
    });

    if (result.merged && pr.incident.status !== IncidentStatus.RESOLVED) {
      await prisma.incident.update({
        where: { id: pr.incidentId },
        data: { status: IncidentStatus.RESOLVED, resolvedAt: new Date() },
      });
    }

    return reply.send({
      verified,
      ciPassed: result.ciPassed,
      merged: result.merged,
      closed: result.closed,
      proof: {
        headSha: result.headSha,
        checksTotal: result.checksTotal,
        checkRuns: result.checkRuns,
        requiredChecks,
        missingChecks,
      },
      pr: updated,
    });
  });
}

async function handleInstallationEvent(payload: Record<string, unknown>, integrationId: string) {
  const action = str(payload.action);
  const installation = obj(payload.installation);
  const account = obj(installation.account);
  const repositories = Array.isArray(payload.repositories)
    ? (payload.repositories as unknown[]).map(r => str(obj(r).full_name))
    : [];

  const installationId = Number(installation.id);
  if (action === 'created' && Number.isSafeInteger(installationId) && installationId > 0) {
    await prisma.gitHubInstallation.upsert({
      where: { githubInstallationId: BigInt(installationId) },
      update: {
        accountLogin: str(account.login, 'unknown'),
        accountType: str(account.type, 'Organization'),
        repositories,
      },
      create: {
        githubInstallationId: BigInt(installationId),
        accountLogin: str(account.login, 'unknown'),
        accountType: str(account.type, 'Organization'),
        repositories,
        integrationId,
      },
    });
  } else if (action === 'deleted' && Number.isSafeInteger(installationId) && installationId > 0) {
    await prisma.gitHubInstallation.deleteMany({
      where: { githubInstallationId: BigInt(installationId), integrationId },
    });
  }
}

async function handlePullRequestEvent(payload: Record<string, unknown>, integrationId: string) {
  const action = str(payload.action);
  const pr = obj(payload.pull_request);
  const prBase = obj(pr.base);
  const repoFullName =
    str(obj(payload.repository).full_name) || str(obj(prBase.repo).full_name);
  const merged = pr.merged === true;

  const ourPR = await prisma.gitHubPullRequest.findFirst({
    where: {
      prNumber: Number(pr.number),
      repository: String(repoFullName),
      installation: { integrationId },
    },
  });

  if (ourPR) {
    const statusMap: Record<string, GitHubPRStatus> = {
      opened: GitHubPRStatus.OPEN,
      closed: merged ? GitHubPRStatus.MERGED : GitHubPRStatus.CLOSED,
      reopened: GitHubPRStatus.OPEN,
    };
    if (!(action in statusMap)) return;
    await prisma.gitHubPullRequest.update({
      where: { id: ourPR.id },
      data: { status: statusMap[action] },
    });

    if (action === 'closed' && merged) {
      await prisma.incident.update({
        where: { id: ourPR.incidentId },
        data: { status: IncidentStatus.RESOLVED, resolvedAt: new Date() },
      });
    }
  }
}

async function handlePushEvent(_payload: Record<string, unknown>) {
  // Push events are recorded for audit, but intentionally do not mutate repair
  // state: a push payload does not identify which open SHAPI PR (if any) owns
  // the branch. workflow_run and pull_request events are authoritative for
  // verification and lifecycle transitions.
}

async function handleWorkflowRunEvent(payload: Record<string, unknown>, integrationId: string) {
  const action = str(payload.action);
  const workflowRun = obj(payload.workflow_run);
  if (action !== 'completed') return;
  if (str(workflowRun.conclusion) !== 'success') return;

  // Only PRs explicitly referenced by this workflow run, in this repository.
  // Never sweep every open SHAPI PR: an unrelated green run must not verify them.
  const repoFullName = str(obj(payload.repository).full_name);
  if (!repoFullName) return;
  const refs = Array.isArray(workflowRun.pull_requests) ? workflowRun.pull_requests : [];

  const { verifyRepairPr } = await import('@shapi/github-integration');

  for (const ref of refs) {
    const prNumber = Number(obj(ref).number);
    if (!prNumber) continue;
    const ours = await prisma.gitHubPullRequest.findFirst({
      where: { prNumber, repository: repoFullName, status: GitHubPRStatus.OPEN, installation: { integrationId } },
      include: {
        installation: true,
        incident: { include: { invariant: { select: { repairRequiredChecks: true } } } },
      },
    });
    if (!ours) continue;

    let result;
    try {
      const installationId = Number(ours.installation?.githubInstallationId);
      result = Number.isSafeInteger(installationId) && installationId > 0
        ? await verifyRepairPr(repoFullName, prNumber, undefined, undefined, installationId)
        : await verifyRepairPr(repoFullName, prNumber);
    } catch {
      continue;
    }
    // CI passing plus configured target checks marks verified only. It never sets MERGED and never resolves
    // the incident; those follow solely from actual merged state via the
    // pull_request closed+merged webhook.
    const requiredChecks = ours.incident.invariant?.repairRequiredChecks ?? [];
    const verified = result.verified && missingRequiredChecks(requiredChecks, result.checkRuns ?? []).length === 0;
    await prisma.gitHubPullRequest.update({
      where: { id: ours.id },
      data: {
        verified,
        verificationHeadSha: result.headSha,
        verificationChecks: result.checkRuns,
        verifiedAt: verified ? new Date() : null,
      },
    });
  }
}
