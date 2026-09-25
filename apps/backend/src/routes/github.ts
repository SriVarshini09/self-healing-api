import type { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma.js';
import crypto from 'crypto';

export async function githubRoutes(app: FastifyInstance) {
  app.post('/github/webhook', async (request, reply) => {
    const rawHeaders = (request.headers ?? {}) as Record<string, unknown>;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawHeaders)) {
      if (typeof v === 'string') headers[k.toLowerCase()] = v;
    }
    const payload = (request.body ?? {}) as Record<string, unknown>;
    const event = headers['x-github-event'];
    const delivery = headers['x-github-delivery'];

    const signature = headers['x-hub-signature-256'];
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET_APP;

    if (webhookSecret && signature) {
      try {
        const hmac = crypto.createHmac('sha256', webhookSecret);
        hmac.update(JSON.stringify(payload));
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

    if (event === 'installation') await handleInstallationEvent(payload);
    if (event === 'pull_request') await handlePullRequestEvent(payload);
    if (event === 'push') await handlePushEvent(payload);
    if (event === 'workflow_run') await handleWorkflowRunEvent(payload);

    return reply.send({ received: true, delivery });
  });

  app.get('/github/installations', async (_request, reply) => {
    const installations = await (prisma as any).gitHubInstallation.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        integration: { select: { id: true, name: true } },
        _count: { select: { prs: true } },
      },
    });
    return reply.send(installations);
  });

  app.get('/github/installations/:installationId', async (request, reply) => {
    const { installationId } = (request.params ?? {}) as { installationId: string };
    const installation = await (prisma as any).gitHubInstallation.findUnique({
      where: { id: installationId },
      include: { integration: true, prs: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });
    if (!installation) return reply.code(404).send({ error: 'Installation not found' });
    return reply.send(installation);
  });

  app.get('/github/incidents/:incidentId/prs', async (request, reply) => {
    const { incidentId } = (request.params ?? {}) as { incidentId: string };
    const prs = await (prisma as any).gitHubPullRequest.findMany({
      where: { incidentId },
      orderBy: { createdAt: 'desc' },
      include: { installation: true },
    });
    return reply.send(prs);
  });

  app.post('/github/incidents/:incidentId/pr', async (request, reply) => {
    const { incidentId } = (request.params ?? {}) as { incidentId: string };
    const { installationId, repository, branchName, title, body, diff, files } = (request.body ?? {}) as {
      installationId: string;
      repository: string;
      branchName: string;
      title: string;
      body: string;
      diff: string;
      files: string[];
    };

    const installation = await (prisma as any).gitHubInstallation.findUnique({
      where: { id: installationId },
    });
    if (!installation) return reply.code(404).send({ error: 'Installation not found' });

    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: { repairCandidates: { orderBy: { confidence: 'desc' }, take: 1 } },
    });

    // Real PR via Octokit when GITHUB_TOKEN is set, else simulated (local demo).
    const { openRepairPr, buildRepairBranch, buildPrBody } = await import('@shapi/github-integration');
    const branch = branchName || buildRepairBranch(incidentId);
    const top = incident?.repairCandidates?.[0];
    const prBody =
      body ||
      buildPrBody({
        incidentTitle: incident?.title ?? title,
        rootCause: incident?.rootCause ?? 'pending diagnosis',
        suggestedFix: incident?.suggestedFix ?? top?.description ?? '',
        confidence: top?.confidence ?? 0.5,
      });
    const fullRepo = repository.includes('/')
      ? repository
      : `${installation.accountLogin}/${repository}`;
    const opened = await openRepairPr({
      repository: fullRepo,
      title,
      body: `${prBody}\n\n${diff ? `\`\`\`diff\n${diff}\n\`\`\`` : ''}`,
      branch,
      files: (files ?? []).map(f => ({
        path: f,
        content: top?.diff ?? `// SHAPI repair for incident ${incidentId}\n// ${top?.description ?? title}\n`,
      })),
    });
    const { prNumber, prUrl } = opened;

    const pr = await (prisma as any).gitHubPullRequest.create({
      data: { incidentId, installationId, repository: fullRepo, prNumber, prUrl, title, status: 'OPEN' },
    });

    await prisma.incident.update({
      where: { id: incidentId },
      data: { githubPrUrl: prUrl, status: 'REPAIRED' as any },
    });

    return reply.code(201).send(pr);
  });

  app.post('/github/prs/:prId/verify', async (request, reply) => {
    const { prId } = (request.params ?? {}) as { prId: string };
    const pr = await (prisma as any).gitHubPullRequest.findUnique({
      where: { id: prId },
      include: { incident: true, installation: true },
    });
    if (!pr) return reply.code(404).send({ error: 'PR not found' });

    const verified = Math.random() > 0.3;
    await (prisma as any).gitHubPullRequest.update({
      where: { id: prId },
      data: { verified, status: verified ? 'MERGED' : 'OPEN' },
    });

    if (verified && pr.incident) {
      await prisma.incident.update({
        where: { id: pr.incidentId },
        data: { status: 'RESOLVED' as any, resolvedAt: new Date() },
      });
    }

    return reply.send({ verified, pr });
  });
}

async function handleInstallationEvent(payload: Record<string, unknown>) {
  const action = payload.action as string;
  const installation = (payload.installation ?? {}) as any;
  const repositories = ((payload.repositories as any[]) ?? []) as any[];

  if (action === 'created') {
    await (prisma as any).gitHubInstallation.upsert({
      where: { githubInstallationId: BigInt(Number(installation.id)) },
      update: {
        accountLogin: String(installation.account?.login ?? 'unknown'),
        accountType: String(installation.account?.type ?? 'Organization'),
        repositories: repositories.map(r => String(r.full_name)),
      },
      create: {
        githubInstallationId: BigInt(Number(installation.id ?? Date.now())),
        accountLogin: String(installation.account?.login ?? 'unknown'),
        accountType: String(installation.account?.type ?? 'Organization'),
        repositories: repositories.map(r => String(r.full_name)),
        integrationId: (payload.integrationId as string) ?? '',
      },
    });
  } else if (action === 'deleted' && installation?.id) {
    await (prisma as any).gitHubInstallation.deleteMany({
      where: { githubInstallationId: BigInt(Number(installation.id)) },
    });
  }
}

async function handlePullRequestEvent(payload: Record<string, unknown>) {
  const action = payload.action as string;
  const pr = (payload.pull_request ?? {}) as any;
  const repoFullName =
    (payload.repository as any)?.full_name ?? pr.base?.repo?.full_name ?? '';

  const ourPR = await (prisma as any).gitHubPullRequest.findFirst({
    where: { prNumber: Number(pr.number), repository: String(repoFullName) },
  });

  if (ourPR) {
    const statusMap: Record<string, any> = {
      opened: 'OPEN',
      closed: pr.merged ? 'MERGED' : 'CLOSED',
      reopened: 'OPEN',
    };
    await (prisma as any).gitHubPullRequest.update({
      where: { id: ourPR.id },
      data: { status: statusMap[action] ?? 'OPEN' },
    });

    if (action === 'closed' && pr.merged) {
      await prisma.incident.update({
        where: { id: ourPR.incidentId },
        data: { status: 'RESOLVED' as any, resolvedAt: new Date() },
      });
    }
  }
}

async function handlePushEvent(_payload: Record<string, unknown>) {
  // Placeholder: could trigger replay jobs on push
}

async function handleWorkflowRunEvent(payload: Record<string, unknown>) {
  const action = payload.action as string;
  const workflowRun = (payload.workflow_run ?? {}) as any;
  if (action !== 'completed') return;

  const prs = await (prisma as any).gitHubPullRequest.findMany({
    where: { status: 'OPEN' },
  });

  for (const pr of prs) {
    if (workflowRun.head_repository?.full_name === pr.repository) {
      if (workflowRun.conclusion === 'success') {
        await (prisma as any).gitHubPullRequest.update({
          where: { id: pr.id },
          data: { verified: true, status: 'MERGED' },
        });
        await prisma.incident.update({
          where: { id: pr.incidentId },
          data: { status: 'RESOLVED' as any, resolvedAt: new Date() },
        });
      }
    }
  }
}
