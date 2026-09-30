import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createHmac } from 'node:crypto';
import type { TenantRole } from '@prisma/client';
import { githubRoutes } from '../github.js';
import type { AuthenticatedRequest } from '../../utils/auth-context.js';

// ---------------------------------------------------------------------------
// In-memory Prisma substitute. Route handlers only touch
// gitHubPullRequest (findUnique/findFirst/update) and incident (update),
// so the fake implements exactly that surface.
// ---------------------------------------------------------------------------
interface FakePr {
  id: string;
  prNumber: number;
  repository: string;
  status: string;
  verified: boolean;
  incidentId: string;
}

interface FakeIncident {
  id: string;
  status: string;
  resolvedAt: Date | null;
  title: string;
  rootCause: string;
  suggestedFix: string;
  githubPrUrl?: string;
}

interface FakeCandidate {
  id: string;
  incidentId: string;
  description: string;
  diff: string | null;
  confidence: number;
  changes: unknown;
  repository?: string | null;
}

type FakePrWhere = { id?: string; prNumber?: number; repository?: string; status?: string };
type FakePrUpdateArgs = { where: { id: string }; data: Partial<FakePr> };
type FakeIncidentUpdateArgs = { where: { id: string }; data: Partial<FakeIncident> };

const db = { prs: [] as FakePr[], incidents: [] as FakeIncident[], candidates: [] as FakeCandidate[] };

function matchesPr(p: FakePr, where: Record<string, unknown>): boolean {
  if (where.id !== undefined && p.id !== where.id) return false;
  if (where.prNumber !== undefined && p.prNumber !== where.prNumber) return false;
  if (where.repository !== undefined && p.repository !== where.repository) return false;
  if (where.status !== undefined && p.status !== where.status) return false;
  return true;
}

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    integration: {
      findMany: vi.fn(async () => [{
        id: 'github-demo',
        type: 'GITHUB',
        webhookEnabled: true,
        webhookSecret: 'test-secret',
        config: {},
      }]),
    },
    gitHubInstallation: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === 'install-1' ? {
          id: 'install-1', githubInstallationId: BigInt(-1),
          accountLogin: 'acme', repositories: ['acme/demo'],
        } : null),
    },
    gitHubPullRequest: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => db.prs.find(p => p.id === where.id) ?? null),
      findFirst: vi.fn(async ({ where }: { where: FakePrWhere }) => {
        const found = db.prs.find(p => matchesPr(p, where));
        return found ? { ...found, incident: db.incidents.find(i => i.id === found.incidentId) } : null;
      }),
      update: vi.fn(async ({ where, data }: FakePrUpdateArgs) => {
        const pr = db.prs.find(p => p.id === where.id);
        if (!pr) throw new Error('PR not found');
        Object.assign(pr, data);
        return pr;
      }),
      create: vi.fn(async ({ data }: { data: Omit<FakePr, 'id' | 'verified'> & { prUrl: string } }) => {
        const created = { ...data, id: 'new-pr', verified: false };
        db.prs.push(created);
        return created;
      }),
    },
    incident: {
      findUnique: vi.fn(async ({ where, include }: {
        where: { id: string };
        include: { repairCandidates: { where: { id: string } } };
      }) => {
        const incident = db.incidents.find(i => i.id === where.id);
        return incident ? {
          ...incident,
          repairCandidates: db.candidates.filter(c => c.incidentId === incident.id && c.id === include.repairCandidates.where.id),
        } : null;
      }),
      update: vi.fn(async ({ where, data }: FakeIncidentUpdateArgs) => {
        const inc = db.incidents.find(i => i.id === where.id);
        if (!inc) throw new Error('Incident not found');
        Object.assign(inc, data);
        return inc;
      }),
    },
  },
}));

const verifyRepairPrMock = vi.fn();
const openRepairPrFromChangesMock = vi.fn();

vi.mock('@shapi/github-integration', () => ({
  verifyRepairPr: (...args: unknown[]) => verifyRepairPrMock(...args),
  openRepairPrFromChanges: (...args: unknown[]) => openRepairPrFromChangesMock(...args),
  openRepairPr: vi.fn(),
  buildRepairBranch: vi.fn((id: string) => `shapi/fix-${id.slice(0, 8)}`),
  buildPrBody: vi.fn(() => 'Generated PR body'),
  RepairChangeError: class extends Error {},
}));

function seedDb() {
  db.prs = [
    { id: 'pr-1', prNumber: 10, repository: 'acme/demo', status: 'OPEN', verified: false, incidentId: 'inc-1' },
    { id: 'pr-2', prNumber: 11, repository: 'acme/demo', status: 'OPEN', verified: false, incidentId: 'inc-2' },
  ];
  db.incidents = [
    { id: 'inc-1', status: 'REPAIRED', resolvedAt: null, title: 'Incident one', rootCause: 'cause', suggestedFix: 'fix' },
    { id: 'inc-2', status: 'REPAIRED', resolvedAt: null, title: 'Incident two', rootCause: 'cause', suggestedFix: 'fix' },
  ];
  db.candidates = [];
}

let app: FastifyInstance;

beforeEach(async () => {
  seedDb();
  verifyRepairPrMock.mockReset();
  openRepairPrFromChangesMock.mockReset();
  process.env.GITHUB_WEBHOOK_SECRET_APP = 'test-secret';
  process.env.GITHUB_TOKEN = 'test-token';
  app = Fastify();
  app.addHook('onRequest', async request => {
    (request as AuthenticatedRequest).shapiAuth = {
      id: 'test-key',
      name: 'GitHub route test key',
      tenantId: 'tenant-local-dev',
      role: 'OWNER' as TenantRole,
      permissions: ['*'],
    };
  });
  await githubRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  delete process.env.GITHUB_WEBHOOK_SECRET_APP;
  delete process.env.GITHUB_TOKEN;
});

function signedHeaders(payload: Record<string, unknown>, event: string) {
  const body = JSON.stringify(payload);
  return {
    'x-github-event': event,
    'x-hub-signature-256': `sha256=${createHmac('sha256', 'test-secret').update(body).digest('hex')}`,
  };
}

function pr(id: string): FakePr {
  const found = db.prs.find(p => p.id === id);
  if (!found) throw new Error(`missing PR ${id}`);
  return found;
}

function incident(id: string): FakeIncident {
  const found = db.incidents.find(i => i.id === id);
  if (!found) throw new Error(`missing incident ${id}`);
  return found;
}

const passingCi = {
  verified: true,
  ciPassed: true,
  merged: false,
  closed: false,
  headSha: 'abc123',
  checksTotal: 2,
};

const failingCi = {
  verified: false,
  ciPassed: false,
  merged: false,
  closed: false,
  headSha: 'abc123',
  checksTotal: 2,
};

const mergedPr = {
  verified: true,
  ciPassed: true,
  merged: true,
  closed: true,
  headSha: 'abc123',
  checksTotal: 2,
};

const closedPr = {
  verified: false,
  ciPassed: false,
  merged: false,
  closed: true,
  headSha: 'abc123',
  checksTotal: 2,
};

const candidateA = '11111111-1111-4111-8111-111111111111';
const candidateB = '22222222-2222-4222-8222-222222222222';

describe('POST /github/incidents/:incidentId/pr', () => {
  const payload = { installationId: 'install-1', repository: 'acme/demo', candidateId: candidateB, title: 'Repair' };

  it('applies only the selected persisted candidate', async () => {
    const selectedChanges = [{ kind: 'replace', path: 'src/selected.ts', before: 'old', after: 'new' }];
    db.candidates = [
      { id: candidateA, incidentId: 'inc-1', description: 'Other', diff: 'other diff', confidence: 0.9, changes: null },
      { id: candidateB, incidentId: 'inc-1', description: 'Selected', diff: 'selected diff', confidence: 0.7, changes: selectedChanges, repository: 'acme/demo' },
    ];
    openRepairPrFromChangesMock.mockResolvedValue({ prNumber: 42, prUrl: 'https://github.com/acme/demo/pull/42', real: true });

    const res = await app.inject({ method: 'POST', url: '/github/incidents/inc-1/pr', payload });
    expect(res.statusCode).toBe(201);
    expect(openRepairPrFromChangesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: selectedChanges,
        branch: 'shapi/fix-inc-1-22222222',
        body: expect.stringContaining('selected diff'),
      }), undefined, undefined, -1,
    );
    expect(res.json()).toMatchObject({ prNumber: 42, status: 'OPEN' });
  });

  it('rejects a suggestion with no applicable file changes', async () => {
    db.candidates = [{ id: candidateB, incidentId: 'inc-1', description: 'Manual', diff: '+ proposed', confidence: 0.8, changes: null }];
    const res = await app.inject({ method: 'POST', url: '/github/incidents/inc-1/pr', payload });
    expect(res.statusCode).toBe(409);
    expect(openRepairPrFromChangesMock).not.toHaveBeenCalled();
  });

  it('rejects client supplied files and changes', async () => {
    db.candidates = [{ id: candidateB, incidentId: 'inc-1', description: 'Selected', diff: null, confidence: 0.7, changes: [{ kind: 'create', path: 'safe.txt', content: 'safe' }] }];
    const res = await app.inject({ method: 'POST', url: '/github/incidents/inc-1/pr', payload: { ...payload, files: ['unsafe.txt'] } });
    expect(res.statusCode).toBe(400);
    expect(openRepairPrFromChangesMock).not.toHaveBeenCalled();
  });

  it('rejects a candidate mapped to another repository', async () => {
    db.candidates = [{ id: candidateB, incidentId: 'inc-1', description: 'Selected', diff: null, confidence: 0.7, changes: [{ kind: 'create', path: 'safe.txt', content: 'safe' }], repository: 'acme/other' }];
    const res = await app.inject({ method: 'POST', url: '/github/incidents/inc-1/pr', payload });
    expect(res.statusCode).toBe(409);
    expect(openRepairPrFromChangesMock).not.toHaveBeenCalled();
  });

  it('does not reopen a resolved incident through PR creation', async () => {
    db.incidents[0].status = 'RESOLVED';
    db.candidates = [{ id: candidateB, incidentId: 'inc-1', description: 'Selected', diff: null, confidence: 0.7, changes: [{ kind: 'create', path: 'safe.txt', content: 'safe' }] }];
    const res = await app.inject({ method: 'POST', url: '/github/incidents/inc-1/pr', payload });
    expect(res.statusCode).toBe(409);
    expect(openRepairPrFromChangesMock).not.toHaveBeenCalled();
    expect(db.incidents[0].status).toBe('RESOLVED');
  });
});

describe('POST /github/prs/:prId/verify', () => {
  it('passing CI marks verified without touching status or incident', async () => {
    verifyRepairPrMock.mockResolvedValue(passingCi);

    const res = await app.inject({ method: 'POST', url: '/github/prs/pr-1/verify' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { verified: boolean; ciPassed: boolean; pr: FakePr };

    // Response carries the UPDATED row, not the stale pre-verification object.
    expect(body.verified).toBe(true);
    expect(body.ciPassed).toBe(true);
    expect(body.pr.verified).toBe(true);

    // CI success changes verified and nothing else.
    expect(pr('pr-1').verified).toBe(true);
    expect(pr('pr-1').status).toBe('OPEN');
    expect(incident('inc-1').status).toBe('REPAIRED');
    expect(incident('inc-1').status).not.toBe('RESOLVED');
    expect(incident('inc-1').resolvedAt).toBeNull();
  });

  it('failing CI marks unverified and leaves everything else alone', async () => {
    verifyRepairPrMock.mockResolvedValue(failingCi);

    const res = await app.inject({ method: 'POST', url: '/github/prs/pr-1/verify' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { verified: boolean; ciPassed: boolean; pr: FakePr };
    expect(body.verified).toBe(false);
    expect(body.ciPassed).toBe(false);
    expect(body.pr.verified).toBe(false);

    expect(pr('pr-1').verified).toBe(false);
    expect(pr('pr-1').status).toBe('OPEN');
    expect(incident('inc-1').status).toBe('REPAIRED');
    expect(incident('inc-1').resolvedAt).toBeNull();
  });

  it('merged GitHub state synchronizes PR and incident lifecycle', async () => {
    verifyRepairPrMock.mockResolvedValue(mergedPr);

    const res = await app.inject({ method: 'POST', url: '/github/prs/pr-1/verify' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { merged: boolean; closed: boolean; pr: FakePr };
    expect(body.merged).toBe(true);
    expect(body.closed).toBe(true);
    expect(body.pr.status).toBe('MERGED');
    expect(pr('pr-1').status).toBe('MERGED');
    expect(incident('inc-1').status).toBe('RESOLVED');
    expect(incident('inc-1').resolvedAt).not.toBeNull();
  });

  it('closed but unmerged GitHub state closes the PR without resolving the incident', async () => {
    verifyRepairPrMock.mockResolvedValue(closedPr);

    const res = await app.inject({ method: 'POST', url: '/github/prs/pr-1/verify' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { merged: boolean; closed: boolean; pr: FakePr };
    expect(body.merged).toBe(false);
    expect(body.closed).toBe(true);
    expect(body.pr.status).toBe('CLOSED');
    expect(pr('pr-1').status).toBe('CLOSED');
    expect(incident('inc-1').status).toBe('REPAIRED');
    expect(incident('inc-1').resolvedAt).toBeNull();
  });

  it('verification failure returns 502 with no state changes', async () => {
    verifyRepairPrMock.mockRejectedValue(new Error('GITHUB_TOKEN is not configured'));

    const res = await app.inject({ method: 'POST', url: '/github/prs/pr-1/verify' });
    expect(res.statusCode).toBe(502);

    expect(pr('pr-1').verified).toBe(false);
    expect(pr('pr-1').status).toBe('OPEN');
    expect(incident('inc-1').status).toBe('REPAIRED');
    expect(incident('inc-1').resolvedAt).toBeNull();
  });

  it('unknown PR returns 404', async () => {
    const res = await app.inject({ method: 'POST', url: '/github/prs/nope/verify' });
    expect(res.statusCode).toBe(404);
  });
});

describe('workflow_run webhook scoping', () => {
  function workflowPayload(overrides: Record<string, unknown> = {}) {
    return {
      action: 'completed',
      repository: { full_name: 'acme/demo' },
      workflow_run: {
        conclusion: 'success',
        head_repository: { full_name: 'acme/demo' },
        pull_requests: [{ number: 10 }],
      },
      ...overrides,
    };
  }

  async function postWorkflow(payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/github/webhook',
      headers: signedHeaders(payload, 'workflow_run'),
      payload,
    });
  }

  it('verifies only the referenced PR, never MERGEs or RESOLVEs', async () => {
    verifyRepairPrMock.mockResolvedValue(passingCi);

    const res = await postWorkflow(workflowPayload());
    expect(res.statusCode).toBe(200);
    expect(verifyRepairPrMock).toHaveBeenCalledTimes(1);
    expect(verifyRepairPrMock).toHaveBeenCalledWith('acme/demo', 10);

    expect(pr('pr-1').verified).toBe(true);
    // Unrelated OPEN PR in the same repo is untouched.
    expect(pr('pr-2').verified).toBe(false);

    expect(pr('pr-1').status).toBe('OPEN');
    expect(pr('pr-2').status).toBe('OPEN');
    expect(incident('inc-1').status).toBe('REPAIRED');
    expect(incident('inc-2').status).toBe('REPAIRED');
    expect(incident('inc-1').resolvedAt).toBeNull();
    expect(incident('inc-2').resolvedAt).toBeNull();
  });

  it('ignores non-success conclusions', async () => {
    const res = await postWorkflow(workflowPayload({ workflow_run: { conclusion: 'failure', pull_requests: [{ number: 10 }] } }));
    expect(res.statusCode).toBe(200);
    expect(verifyRepairPrMock).not.toHaveBeenCalled();
    expect(pr('pr-1').verified).toBe(false);
  });

  it('ignores non-completed actions', async () => {
    const res = await postWorkflow(workflowPayload({ action: 'requested' }));
    expect(res.statusCode).toBe(200);
    expect(verifyRepairPrMock).not.toHaveBeenCalled();
    expect(pr('pr-1').verified).toBe(false);
  });

  it('verifies nothing when pull_requests is empty', async () => {
    const res = await postWorkflow(
      workflowPayload({ workflow_run: { conclusion: 'success', pull_requests: [] } }),
    );
    expect(res.statusCode).toBe(200);
    expect(verifyRepairPrMock).not.toHaveBeenCalled();
    expect(pr('pr-1').verified).toBe(false);
    expect(pr('pr-2').verified).toBe(false);
  });

  it('ignores PR numbers from another repository', async () => {
    const res = await postWorkflow(
      workflowPayload({
        repository: { full_name: 'other/repo' },
        workflow_run: { conclusion: 'success', pull_requests: [{ number: 10 }] },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(verifyRepairPrMock).not.toHaveBeenCalled();
    expect(pr('pr-1').verified).toBe(false);
  });
});

describe('pull_request merge webhook lifecycle path', () => {
  it('closed+merged sets PR MERGED, incident RESOLVED, resolvedAt', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/github/webhook',
      headers: signedHeaders({
        action: 'closed',
        repository: { full_name: 'acme/demo' },
        pull_request: { number: 10, merged: true, base: { repo: { full_name: 'acme/demo' } } },
      }, 'pull_request'),
      payload: {
        action: 'closed',
        repository: { full_name: 'acme/demo' },
        pull_request: { number: 10, merged: true, base: { repo: { full_name: 'acme/demo' } } },
      },
    });
    expect(res.statusCode).toBe(200);

    expect(pr('pr-1').status).toBe('MERGED');
    expect(incident('inc-1').status).toBe('RESOLVED');
    expect(incident('inc-1').resolvedAt).not.toBeNull();

    // The sibling PR/incident are untouched.
    expect(pr('pr-2').status).toBe('OPEN');
    expect(incident('inc-2').status).toBe('REPAIRED');
  });
});
