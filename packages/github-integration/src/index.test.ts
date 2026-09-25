import { describe, it, expect, vi, afterEach } from 'vitest';
import crypto from 'crypto';
import { verifyWebhookSignature, buildPrBody, shouldAutoMerge, openRepairPr } from './index.js';

afterEach(() => {
  delete process.env.GITHUB_TOKEN;
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

  it('creates a real PR through an injected client (no network)', async () => {
    const calls: string[] = [];
    const fake = {
      rest: {
        git: {
          getRef: vi.fn(async () => ({ data: { object: { sha: 'base-sha' } } })),
          createRef: vi.fn(async () => {
            calls.push('createRef');
            return {};
          }),
        },
        repos: {
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
    expect(calls).toEqual(['createRef', 'writeFile']);
    expect(fake.rest.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({ head: 'shapi/fix-abc', base: 'main' }),
    );
  });

  it('rejects malformed repository names', async () => {
    await expect(
      openRepairPr({ repository: 'nope', title: 't', body: 'b', branch: 'br', files: [] }, 'tok', {} as any),
    ).rejects.toThrow('Invalid repository');
  });
});
