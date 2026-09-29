import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { githubRoutes } from '../github.js';

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
}

const db = { prs: [] as FakePr[], incidents: [] as FakeIncident[] };

function matchesPr(p: FakePr, where: Record<string, unknown>): boolean {
  if (where.id !== undefined && p.id !== where.id) return false;
  if (where.prNumber !== undefined && p.prNumber !== where.prNumber) return false;
  if (where.repository !== undefined && p.repository !== where.repository) return false;
  if (where.status !== undefined && p.status !== where.status) return false;
  return true;
}

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    gitHubPullRequest: {
      findUnique: vi.fn(async ({ where }: any) => db.prs.find(p => p.id === where.id) ?? null),
      findFirst: vi.fn(async ({ where }: any) => db.prs.find(p => matchesPr(p, where)) ?? null),
      update: vi.fn(async ({ where, data }: any) => {
        const pr = db.prs.find(p => p.id === where.id);
        if (!pr) throw new Error('PR not found');
        Object.assign(pr, data);
        return pr;
      }),
    },
    incident: {
      update: vi.fn(async ({ where, data }: any) => {
        const inc = db.incidents.find(i => i.id === where.id);
        if (!inc) throw new Error('Incident not found');
        Object.assign(inc, data);
        return inc;
      }),
    },
  },
}));

const verifyRepairPrMock = vi.fn();

vi.mock('@shapi/github-integration', () => ({
  verifyRepairPr: (...args: unknown[]) => verifyRepairPrMock(...args),
  openRepairPr: vi.fn(),
  buildRepairBranch: vi.fn(),
  buildPrBody: vi.fn(),
}));

function seedDb() {
  db.prs = [
    { id: 'pr-1', prNumber: 10, repository: 'acme/demo', status: 'OPEN', verified: false, incidentId: 'inc-1' },
    { id: 'pr-2', prNumber: 11, repository: 'acme/demo', status: 'OPEN', verified: false, incidentId: 'inc-2' },
  ];
  db.incidents = [
    { id: 'inc-1', status: 'REPAIRED', resolvedAt: null },
    { id: 'inc-2', status: 'REPAIRED', resolvedAt: null },
  ];
}

let app: FastifyInstance;

beforeEach(async () => {
  seedDb();
  verifyRepairPrMock.mockReset();
  delete process.env.GITHUB_WEBHOOK_SECRET_APP;
  app = Fastify();
  await githubRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

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
      headers: { 'x-github-event': 'workflow_run' },
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

describe('pull_request merge webhook (sole RESOLVED path)', () => {
  it('closed+merged sets PR MERGED, incident RESOLVED, resolvedAt', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/github/webhook',
      headers: { 'x-github-event': 'pull_request' },
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
