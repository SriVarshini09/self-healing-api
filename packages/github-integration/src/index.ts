// @shapi/github-integration - verified PR workflow helpers
import crypto from 'crypto';
import { Octokit } from '@octokit/rest';

export function verifyWebhookSignature(secret: string, rawBody: string, signature: string): boolean {
  try {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(rawBody);
    const expected = `sha256=${hmac.digest('hex')}`;
    if (signature.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function buildRepairBranch(incidentId: string): string {
  return `shapi/fix-${incidentId.slice(0, 8)}`;
}

export function buildPrBody(opts: {
  incidentTitle: string;
  rootCause: string;
  suggestedFix: string;
  confidence: number;
  replayPassRate?: number;
}): string {
  return [
    `## SHAPI Verified Repair`,
    ``,
    `**Incident:** ${opts.incidentTitle}`,
    ``,
    `**Root cause:** ${opts.rootCause}`,
    ``,
    `**Fix:** ${opts.suggestedFix}`,
    ``,
    `**Diagnosis confidence:** ${(opts.confidence * 100).toFixed(0)}%`,
    opts.replayPassRate !== undefined
      ? `**Replay pass rate:** ${(opts.replayPassRate * 100).toFixed(1)}%`
      : ``,
    ``,
    `> A 200 OK does not prove success. This PR was generated from a behavioral invariant violation and verified via replay.`,
  ].join('\n');
}

export function shouldAutoMerge(opts: { verified: boolean; ciPassed: boolean }): boolean {
  return opts.verified && opts.ciPassed;
}

export interface RepairFile {
  path: string;
  content: string;
}

export interface OpenRepairPrOptions {
  /** "owner/repo" */
  repository: string;
  title: string;
  body: string;
  branch: string;
  files: RepairFile[];
  base?: string;
}

export interface OpenRepairPrResult {
  prNumber: number;
  prUrl: string;
  /** false when no token was configured and the PR was simulated */
  real: boolean;
}

/**
 * Open a repair PR on GitHub. Uses a real Octokit client when `token` (or
 * GITHUB_TOKEN) is set; otherwise returns a simulated PR so local demos work
 * without credentials. Accepts an injected `client` for tests.
 */
export async function openRepairPr(
  opts: OpenRepairPrOptions,
  token?: string,
  client?: Pick<Octokit, 'rest'>,
): Promise<OpenRepairPrResult> {
  const auth = token ?? process.env.GITHUB_TOKEN;
  if (!auth && !client) {
    const prNumber = Math.floor(Math.random() * 10000) + 1;
    return { prNumber, prUrl: `https://github.com/${opts.repository}/pull/${prNumber}`, real: false };
  }

  const octokit = client ?? (new Octokit({ auth }) as Pick<Octokit, 'rest'>);
  const [owner, repo] = opts.repository.split('/');
  if (!owner || !repo) throw new Error(`Invalid repository "${opts.repository}" (want owner/repo)`);
  const base = opts.base ?? 'main';

  const { data: baseRef } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${base}` });
  const baseSha = baseRef.object.sha;

  try {
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${opts.branch}`,
      sha: baseSha,
    });
  } catch (e: any) {
    if (e?.status !== 422) throw e; // 422 = branch already exists, reuse it
  }

  for (const file of opts.files) {
    let sha: string | undefined;
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: file.path,
        ref: opts.branch,
      });
      if (!Array.isArray(data) && data.type === 'file') sha = data.sha;
    } catch (e: any) {
      if (e?.status !== 404) throw e;
    }
    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: file.path,
      message: `shapi: ${opts.title} (${file.path})`,
      content: Buffer.from(file.content, 'utf8').toString('base64'),
      branch: opts.branch,
      ...(sha ? { sha } : {}),
    });
  }

  const { data: pr } = await octokit.rest.pulls.create({
    owner,
    repo,
    title: opts.title,
    body: opts.body,
    head: opts.branch,
    base,
  });
  return { prNumber: pr.number, prUrl: pr.html_url, real: true };
}
