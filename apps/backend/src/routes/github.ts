import type { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { GitHubPRStatus, IncidentStatus, IntegrationType } from '@prisma/client';
import crypto from 'crypto';
import { z } from 'zod';
import { tenantIdFor } from '../utils/auth-context.js';

type JsonRecord = Record<string, unknown>;

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function obj(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null ? (value as JsonRecord) : {};
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
}).strict();

const repairChangesSchema = z.array(z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('replace'), path: z.string().min(1).max(400), before: z.string().min(1), after: z.string() }).strict(),
  z.object({ kind: z.literal('create'), path: z.string().min(1).max(400), content: z.string() }).strict(),
])).min(1).max(50);

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

    if (event === 'installation') await handleInstallationEvent(payload, integration.id);
    if (event === 'pull_request') await handlePullRequestEvent(payload, integration.id);
    if (event === 'push') await handlePushEvent(payload);
    if (event === 'workflow_run') await handleWorkflowRunEvent(payload, integration.id);

    return reply.send({ received: true, delivery });
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
    const appCredentialsConfigured = Boolean(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY);
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

    return reply.send({
      mode,
      message,
      appCredentialsConfigured,
      tokenConfigured,
      webhookConfigured,
      realInstallations,
      installationCount: installations.length,
      repositoryCount: repositories.size,
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
    return reply.send(prs);
  });

  app.post('/github/incidents/:incidentId/pr', async (request, reply) => {
    const tenantId = tenantIdFor(request);
    const { incidentId } = (request.params ?? {}) as { incidentId: string };
    const parsed = prSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid pull-request payload', details: parsed.error.flatten() });
    const { installationId, repository, candidateId, branchName, base, title, body } = parsed.data;

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
      include: { repairCandidates: { where: { id: candidateId }, take: 1 } },
    });
    if (!incident) return reply.code(404).send({ error: 'Incident not found' });
    if (incident.status === IncidentStatus.RESOLVED || incident.status === IncidentStatus.DISMISSED) {
      return reply.code(409).send({ error: 'Resolved or dismissed incidents cannot create new repair PRs' });
    }
    const candidate = incident.repairCandidates[0];
    if (!candidate) return reply.code(404).send({ error: 'Repair candidate not found for this incident' });
    const changes = repairChangesSchema.safeParse(candidate.changes);
    if (!changes.success) return reply.code(409).send({ error: 'Selected repair candidate has no applicable file changes; review it manually' });

    const hasAppAuth = Boolean(
      process.env.GITHUB_APP_ID &&
      process.env.GITHUB_APP_PRIVATE_KEY &&
      Number(installation.githubInstallationId) > 0,
    );
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
    let opened;
    try {
      opened = await openRepairPrFromChanges({
        repository: fullRepo,
        title,
        body: `${prBody}${candidate.diff ? `\n\nProposed change:\n\`\`\`diff\n${candidate.diff}\n\`\`\`` : ''}`,
        branch,
        ...(base ? { base } : {}),
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
      include: { incident: true, installation: true },
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

    const status = result.merged
      ? GitHubPRStatus.MERGED
      : result.closed
        ? GitHubPRStatus.CLOSED
        : pr.status;
    const updated = await prisma.gitHubPullRequest.update({
      where: { id: prId },
      data: { verified: result.verified, status },
    });

    if (result.merged && pr.incident.status !== IncidentStatus.RESOLVED) {
      await prisma.incident.update({
        where: { id: pr.incidentId },
        data: { status: IncidentStatus.RESOLVED, resolvedAt: new Date() },
      });
    }

    return reply.send({ verified: result.verified, ciPassed: result.ciPassed, merged: result.merged, closed: result.closed, pr: updated });
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
    await prisma.gitHubPullRequest.update({
      where: { id: ourPR.id },
      data: { status: statusMap[action] ?? GitHubPRStatus.OPEN },
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
  // Placeholder: could trigger replay jobs on push
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
      include: { installation: true },
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
    // CI passing marks verified only. It never sets MERGED and never resolves
    // the incident; those follow solely from actual merged state via the
    // pull_request closed+merged webhook.
    if (result.verified) {
      await prisma.gitHubPullRequest.update({
        where: { id: ours.id },
        data: { verified: true },
      });
    }
  }
}
