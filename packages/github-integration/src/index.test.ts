import { describe, it, expect, vi, afterEach } from 'vitest';
import crypto from 'crypto';
import { verifyWebhookSignature, buildPrBody, shouldAutoMerge, openRepairPr, openRepairPrFromChanges, previewRepairPrChanges, verifyPullRequest, verifyRepairPr, hasGitHubAppCredentials, listInstallationRepositories } from './index.js';

afterEach(() => {
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_APP_PRIVATE_KEY;
});

describe('GitHub App authentication configuration', () => {
  it('requires a positive installation id and both App credentials', () => {
    process.env.GITHUB_APP_ID = '12345';
    process.env.GITHUB_APP_PRIVATE_KEY = 'private-key';
    expect(hasGitHubAppCredentials(9876)).toBe(true);
    expect(hasGitHubAppCredentials(-1)).toBe(false);
    expect(hasGitHubAppCredentials()).toBe(false);
  });

  it('lists repositories from an installation-scoped client', async () => {
    const fake = {
      rest: {
        apps: {
          listReposAccessibleToInstallation: vi.fn(async () => ({
            data: {
              repositories: [
                { full_name: 'acme/demo', owner: { login: 'acme', type: 'Organization' } },
              ],
            },
          })),
        },
      },
    };
    await expect(listInstallationRepositories(123, undefined, fake as any)).resolves.toEqual({
      accountLogin: 'acme',
      accountType: 'Organization',
      repositories: ['acme/demo'],
    });
  });
});

describe('github-integration', () => {
  it('verifies signatures', () => {
    const secret = 's3cret';
    const body = JSON.stringify({ a: 1 });
    const sig = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
    expect(verifyWebhookSignature(secret, body, sig)).toBe(true);
    expect(verifyWebhookSignature(secret, body, 'sha256 deadbeef')).toBe(false);
    // pad to same length but wrong content
    expect(verifyWebhookSignature(secret, body, 'x'.repeat(sig.length))).toBe(false);
  });

  it('builds PR body + automerge gate', () => {
    const body = buildPrBody({ incidentTitle: 'drift', rootCause: 'x', suggestedFix: 'y', confidence: 0.9, replayPassRate: 1 });
    expect(body).toContain('Proposed Repair');
    expect(body).toContain('200 OK does not prove success');
    expect(shouldAutoMerge({ verified: true, ciPassed: true })).toBe(true);
    expect(shouldAutoMerge({ verified: true, ciPassed: false })).toBe(false);
  });

  it('simulates a PR when no token is configured', async () => {
    const r = await openRepairPr({
      repository: 'acme/demo',
      title: 'fix',
      body: 'b',
      branch: 'shapi/fix-123',
      files: [],
    });
    expect(r.real).toBe(false);
    expect(r.prUrl).toContain('github.com/acme/demo/pull/');
  });

  it('applies a selected replacement to the real base file before opening a PR', async () => {
    const calls: string[] = [];
    const original = 'export const retry = 1;\n';
    const fake = {
      rest: {
        repos: {
          get: vi.fn(async () => ({ data: { default_branch: 'master' } })),
          getContent: vi.fn(async (args: { ref: string }) => {
            calls.push(`read:${args.ref}`);
            return { data: { type: 'file', encoding: 'base64', content: Buffer.from(original).toString('base64'), sha: 'file-sha' } };
          }),
          createOrUpdateFileContents: vi.fn(async (_args: { content: string; sha: string }) => { calls.push('write'); return {}; }),
        },
        git: {
          getRef: vi.fn(async () => { calls.push('getRef'); return { data: { object: { sha: 'base-sha' } } }; }),
          createRef: vi.fn(async () => { calls.push('createRef'); return {}; }),
        },
        pulls: { create: vi.fn(async () => ({ data: { number: 12, html_url: 'https://github.com/acme/demo/pull/12' } })) },
      },
    };
    const result = await openRepairPrFromChanges({
      repository: 'acme/demo', title: 'Repair', body: 'Review this patch', branch: 'shapi/fix-12',
      changes: [{ kind: 'replace', path: 'src/retry.ts', before: 'retry = 1', after: 'retry = 3' }],
    }, 'fake-token', fake as any);

    expect(result.real).toBe(true);
    expect(calls).toEqual(['getRef', 'read:base-sha', 'createRef', 'read:shapi/fix-12', 'write']);
    const write = fake.rest.repos.createOrUpdateFileContents.mock.calls[0][0] as { content: string; sha: string };
    expect(Buffer.from(write.content, 'base64').toString('utf8')).toBe('export const retry = 3;\n');
    expect(write.sha).toBe('file-sha');
  });

  it('previews an applicable patch without creating a branch, file, or PR', async () => {
    const fake = {
      rest: {
        repos: {
          get: vi.fn(async () => ({ data: { default_branch: 'main' } })),
          getContent: vi.fn(async () => ({ data: { type: 'file', encoding: 'base64', content: Buffer.from('const mode = "old";\n').toString('base64') } })),
          createOrUpdateFileContents: vi.fn(),
        },
        git: {
          getRef: vi.fn(async () => ({ data: { object: { sha: 'base-sha' } } })),
          createRef: vi.fn(),
        },
        pulls: { create: vi.fn() },
      },
    };
    const result = await previewRepairPrChanges({
      repository: 'acme/demo',
      changes: [{ kind: 'replace', path: 'src/mode.ts', before: '"old"', after: '"new"' }],
    }, 'fake-token', fake as any);
    expect(result).toEqual({
      base: 'main', baseSha: 'base-sha',
      files: [{ path: 'src/mode.ts', kind: 'replace', original: 'const mode = "old";\n', content: 'const mode = "new";\n' }],
    });
    expect(fake.rest.git.createRef).not.toHaveBeenCalled();
    expect(fake.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
    expect(fake.rest.pulls.create).not.toHaveBeenCalled();
  });

  it('rejects a reviewed patch when the target branch has advanced', async () => {
    const fake = {
      rest: {
        repos: {
          get: vi.fn(async () => ({ data: { default_branch: 'main' } })),
          getContent: vi.fn(),
        },
        git: {
          getRef: vi.fn(async () => ({ data: { object: { sha: 'newer-sha' } } })),
          createRef: vi.fn(),
        },
      },
    };
    await expect(previewRepairPrChanges({
      repository: 'acme/demo',
      expectedBaseSha: 'reviewed-sha',
      changes: [{ kind: 'replace', path: 'src/mode.ts', before: 'old', after: 'new' }],
    }, 'fake-token', fake as any)).rejects.toThrow(/stale/);
    expect(fake.rest.repos.getContent).not.toHaveBeenCalled();
    expect(fake.rest.git.createRef).not.toHaveBeenCalled();
  });

  it('rejects an inapplicable change before creating a branch', async () => {
    const fake = {
      rest: {
        repos: {
          get: vi.fn(async () => ({ data: { default_branch: 'master' } })),
          getContent: vi.fn(async () => ({ data: { type: 'file', encoding: 'base64', content: Buffer.from('const x = 1;').toString('base64'), sha: 'sha' } })),
        },
        git: {
          getRef: vi.fn(async () => ({ data: { object: { sha: 'base-sha' } } })),
          createRef: vi.fn(),
        },
      },
    };
    await expect(openRepairPrFromChanges({
      repository: 'acme/demo', title: 'Repair', body: 'b', branch: 'shapi/fix-12',
      changes: [{ kind: 'replace', path: 'src/x.ts', before: 'missing text', after: 'new text' }],
    }, 'fake-token', fake as any)).rejects.toThrow(/missing-before/);
    expect(fake.rest.git.createRef).not.toHaveBeenCalled();
  });

  it('creates a missing file using its complete stored content', async () => {
    const fake = {
      rest: {
        repos: {
          get: vi.fn(async () => ({ data: { default_branch: 'master' } })),
          getContent: vi.fn(async ({ ref }: { ref: string }) => {
            if (ref === 'base-sha') throw { status: 404 };
            throw { status: 404 };
          }),
          createOrUpdateFileContents: vi.fn(async (_args: { content: string; sha?: string }) => ({})),
        },
        git: {
          getRef: vi.fn(async () => ({ data: { object: { sha: 'base-sha' } } })),
          createRef: vi.fn(async () => ({})),
        },
        pulls: { create: vi.fn(async () => ({ data: { number: 13, html_url: 'https://github.com/acme/demo/pull/13' } })) },
      },
    };
    await openRepairPrFromChanges({
      repository: 'acme/demo', title: 'Repair', body: 'Review', branch: 'shapi/fix-13',
      changes: [{ kind: 'create', path: 'src/new.ts', content: 'export const n = 1;\n' }],
    }, 'fake-token', fake as any);
    const write = fake.rest.repos.createOrUpdateFileContents.mock.calls[0][0] as { content: string; sha?: string };
    expect(Buffer.from(write.content, 'base64').toString('utf8')).toBe('export const n = 1;\n');
    expect(write.sha).toBeUndefined();
  });

  it('does not write into an existing repair branch', async () => {
    const fake = {
      rest: {
        repos: {
          get: vi.fn(async () => ({ data: { default_branch: 'master' } })),
          getContent: vi.fn(async () => ({ data: { type: 'file', encoding: 'base64', content: Buffer.from('before').toString('base64') } })),
          createOrUpdateFileContents: vi.fn(),
        },
        git: {
          getRef: vi.fn(async () => ({ data: { object: { sha: 'base-sha' } } })),
          createRef: vi.fn(async () => { throw { status: 422 }; }),
        },
        pulls: { create: vi.fn() },
      },
    };
    await expect(openRepairPrFromChanges({
      repository: 'acme/demo', title: 'Repair', body: 'Review', branch: 'shapi/fix-14',
      changes: [{ kind: 'replace', path: 'src/x.ts', before: 'before', after: 'after' }],
    }, 'fake-token', fake as any)).rejects.toThrow(/already exists/);
    expect(fake.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
    expect(fake.rest.pulls.create).not.toHaveBeenCalled();
  });

  it('discovers the default branch instead of assuming main', async () => {
    const calls: string[] = [];
    const fake = {
      rest: {
        git: {
          getRef: vi.fn(async (args: any) => {
            calls.push(`getRef:${args.ref}`);
            return { data: { object: { sha: 'base-sha' } } };
          }),
          createRef: vi.fn(async () => {
            calls.push('createRef');
            return {};
          }),
        },
        repos: {
          get: vi.fn(async () => ({ data: { default_branch: 'master' } })),
          getContent: vi.fn(async () => {
            const e: any = new Error('not found');
            e.status = 404;
            throw e;
          }),
          createOrUpdateFileContents: vi.fn(async () => {
            calls.push('writeFile');
            return {};
          }),
        },
        pulls: {
          create: vi.fn(async () => ({ data: { number: 42, html_url: 'https://github.com/acme/demo/pull/42' } })),
        },
      },
    };
    const r = await openRepairPr(
      {
        repository: 'acme/demo',
        title: 'SHAPI fix',
        body: 'verified repair',
        branch: 'shapi/fix-abc',
        files: [{ path: 'invariants/pay.ts', content: 'export const x = 1;\n' }],
      },
      'fake-token',
      fake as any,
    );
    expect(r).toEqual({ prNumber: 42, prUrl: 'https://github.com/acme/demo/pull/42', real: true });
    expect(calls).toEqual(['getRef:heads/master', 'createRef', 'writeFile']);
    expect(fake.rest.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({ head: 'shapi/fix-abc', base: 'master' }),
    );
  });

  it('uses an explicitly pinned base without discovery', async () => {
    const fake = {
      rest: {
        git: {
          getRef: vi.fn(async () => ({ data: { object: { sha: 'base-sha' } } })),
          createRef: vi.fn(async () => ({})),
        },
        repos: {
          get: vi.fn(async () => {
            throw new Error('discovery must not run when base is pinned');
          }),
          getContent: vi.fn(async () => {
            const e: any = new Error('not found');
            e.status = 404;
            throw e;
          }),
          createOrUpdateFileContents: vi.fn(async () => ({})),
        },
        pulls: {
          create: vi.fn(async () => ({ data: { number: 7, html_url: 'https://github.com/acme/demo/pull/7' } })),
        },
      },
    };
    const r = await openRepairPr(
      {
        repository: 'acme/demo',
        title: 'SHAPI fix',
        body: 'verified repair',
        branch: 'shapi/fix-abc',
        base: 'develop',
        files: [],
      },
      'fake-token',
      fake as any,
    );
    expect(r.real).toBe(true);
    expect(fake.rest.git.getRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'heads/develop' }),
    );
    expect(fake.rest.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({ base: 'develop' }),
    );
  });

  it('verifyRepairPr reports verified when all CI checks pass', async () => {
    const fake = {
      rest: {
        pulls: {
          get: vi.fn(async () => ({
            data: { number: 42, state: 'open', merged: false, head: { sha: 'abc123' } },
          })),
        },
        checks: {
          listForRef: vi.fn(async () => ({
            data: {
              total_count: 2,
              check_runs: [
                { status: 'completed', conclusion: 'success' },
                { status: 'completed', conclusion: 'success' },
              ],
            },
          })),
        },
      },
    };
    const r = await verifyRepairPr('acme/demo', 42, 'fake-token', fake as any);
    expect(r).toEqual({
      verified: true,
      ciPassed: true,
      merged: false,
      closed: false,
      headSha: 'abc123',
      checksTotal: 2,
      checkRuns: [
        { name: 'unnamed check', status: 'completed', conclusion: 'success', detailsUrl: null },
        { name: 'unnamed check', status: 'completed', conclusion: 'success', detailsUrl: null },
      ],
    });
    expect(fake.rest.checks.listForRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'abc123' }),
    );
  });

  it('verifyRepairPr reports unverified when any CI check fails', async () => {
    const fake = {
      rest: {
        pulls: {
          get: vi.fn(async () => ({
            data: { number: 42, state: 'open', merged: false, head: { sha: 'abc123' } },
          })),
        },
        checks: {
          listForRef: vi.fn(async () => ({
            data: {
              total_count: 2,
              check_runs: [
                { status: 'completed', conclusion: 'success' },
                { status: 'completed', conclusion: 'failure' },
              ],
            },
          })),
        },
      },
    };
    const r = await verifyRepairPr('acme/demo', 42, 'fake-token', fake as any);
    expect(r.verified).toBe(false);
    expect(r.ciPassed).toBe(false);
    expect(r.merged).toBe(false);
    expect(r.checksTotal).toBe(2);
  });

  it('verifyRepairPr fails closed when a later check-run page fails', async () => {
    const pageOne = Array.from({ length: 100 }, () => ({ status: 'completed', conclusion: 'success' }));
    const fake = {
      rest: {
        pulls: {
          get: vi.fn(async () => ({
            data: { number: 42, state: 'open', merged: false, head: { sha: 'abc123' } },
          })),
        },
        checks: {
          listForRef: vi.fn(async (args: any) => {
            if ((args.page ?? 1) === 1) return { data: { total_count: 101, check_runs: pageOne } };
            return {
              data: {
                total_count: 101,
                check_runs: [{ status: 'completed', conclusion: 'failure' }],
              },
            };
          }),
        },
      },
    };
    const r = await verifyRepairPr('acme/demo', 42, 'fake-token', fake as any);
    expect(r.verified).toBe(false);
    expect(r.ciPassed).toBe(false);
    expect(r.checksTotal).toBe(101);
    expect(fake.rest.checks.listForRef).toHaveBeenCalledTimes(2);
  });

  it('verifyRepairPr fails closed with zero check runs on an open PR', async () => {
    const fake = {
      rest: {
        pulls: {
          get: vi.fn(async () => ({
            data: { number: 42, state: 'open', merged: false, head: { sha: 'abc123' } },
          })),
        },
        checks: {
          listForRef: vi.fn(async () => ({ data: { total_count: 0, check_runs: [] } })),
        },
      },
    };
    const r = await verifyRepairPr('acme/demo', 42, 'fake-token', fake as any);
    expect(r).toEqual({
      verified: false,
      ciPassed: false,
      merged: false,
      closed: false,
      headSha: 'abc123',
      checksTotal: 0,
      checkRuns: [],
    });
  });

  it('verifyRepairPr fails closed when a check is still running', async () => {
    const fake = {
      rest: {
        pulls: {
          get: vi.fn(async () => ({
            data: { number: 42, state: 'open', merged: false, head: { sha: 'abc123' } },
          })),
        },
        checks: {
          listForRef: vi.fn(async () => ({
            data: {
              total_count: 2,
              check_runs: [
                { status: 'completed', conclusion: 'success' },
                { status: 'in_progress', conclusion: null },
              ],
            },
          })),
        },
      },
    };
    const r = await verifyRepairPr('acme/demo', 42, 'fake-token', fake as any);
    expect(r.verified).toBe(false);
    expect(r.ciPassed).toBe(false);
    expect(r.checksTotal).toBe(2);
  });

  it('verifyRepairPr throws without token or client', async () => {
    delete process.env.GITHUB_TOKEN;
    await expect(verifyRepairPr('acme/demo', 1)).rejects.toThrow('GitHub token or App installation credentials are required');
  });

  it('verifyRepairPr reports merged state from GitHub, not CI', async () => {
    const fake = {
      rest: {
        pulls: {
          get: vi.fn(async () => ({
            data: { number: 42, state: 'closed', merged: true, head: { sha: 'def456' } },
          })),
        },
        checks: {
          listForRef: vi.fn(async () => ({ data: { total_count: 0, check_runs: [] } })),
        },
      },
    };
    const r = await verifyRepairPr('acme/demo', 42, 'fake-token', fake as any);
    expect(r).toEqual({
      verified: false,
      ciPassed: false,
      merged: true,
      closed: true,
      headSha: 'def456',
      checksTotal: 0,
      checkRuns: [],
    });
  });

  it('rejects malformed repository names', async () => {
    await expect(
      openRepairPr({ repository: 'nope', title: 't', body: 'b', branch: 'br', files: [] }, 'tok', {} as any),
    ).rejects.toThrow('Invalid repository');
  });

  it('verifies merged PRs only when all checks pass', async () => {
    const fake = {
      rest: {
        pulls: {
          get: vi.fn(async () => ({ data: { merged: true, merged_at: 'now', state: 'closed', head: { sha: 'sha' } } })),
        },
        checks: {
          listForRef: vi.fn(async () => ({ data: { total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] } })),
        },
      },
    };
    await expect(verifyPullRequest('acme/demo', 42, 'token', fake as any)).resolves.toMatchObject({
      verified: true,
      merged: true,
      ciPassed: true,
      checks: 1,
    });
  });

  it('does not verify a merged PR when GitHub reports no check runs', async () => {
    const fake = {
      rest: {
        pulls: {
          get: vi.fn(async () => ({ data: { merged: true, merged_at: 'now', state: 'closed', head: { sha: 'sha' } } })),
        },
        checks: {
          listForRef: vi.fn(async () => ({ data: { total_count: 0, check_runs: [] } })),
        },
      },
    };
    await expect(verifyPullRequest('acme/demo', 42, 'token', fake as any)).resolves.toMatchObject({
      verified: false,
      merged: true,
      ciPassed: false,
      checks: 0,
    });
  });
});
