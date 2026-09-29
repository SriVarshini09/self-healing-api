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

export interface PullRequestVerificationResult {
  verified: boolean;
  merged: boolean;
  state: string;
  ciPassed: boolean;
  checks: number;
}

/** Verify a real pull request using GitHub state and check runs. */
export async function verifyPullRequest(
  repository: string,
  prNumber: number,
  token?: string,
  client?: Pick<Octokit, 'rest'>,
): Promise<PullRequestVerificationResult> {
  const auth = token ?? process.env.GITHUB_TOKEN;
  if (!auth && !client) throw new Error('GITHUB_TOKEN is required for real PR verification');
  const octokit = client ?? (new Octokit({ auth }) as Pick<Octokit, 'rest'>);
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) throw new Error(`Invalid repository "${repository}" (want owner/repo)`);

  const { data: pull } = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
  const { data: checks } = await octokit.rest.checks.listForRef({
    owner,
    repo,
    ref: pull.head.sha,
  });
  const failed = checks.check_runs.some(check =>
    check.status === 'completed' && !['success', 'skipped', 'neutral'].includes(check.conclusion ?? ''),
  );
  const ciPassed = !failed && checks.check_runs.every(check => check.status === 'completed');
  const merged = Boolean(pull.merged_at) || pull.merged;
  return {
    verified: Boolean(merged && ciPassed),
    merged,
    state: pull.state,
    ciPassed,
    checks: checks.total_count,
  };
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
  // Never assume 'main': discover the repository's actual default branch
  // unless the caller pinned one explicitly.
  const base = opts.base ?? (await octokit.rest.repos.get({ owner, repo })).data.default_branch;

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

export interface VerifyRepairPrResult {
  /** true only when CI check runs on the PR head SHA all pass */
  verified: boolean;
  /** true only when at least one check run exists and every run completed with success */
  ciPassed: boolean;
  /** true only when GitHub reports the PR merged (actual merged state) */
  merged: boolean;
  /** true when GitHub reports the PR closed */
  closed: boolean;
  headSha: string;
  /** number of check runs evaluated for the head SHA */
  checksTotal: number;
}

/**
 * Verify a repair PR against real GitHub state: fetch the PR, read the check
 * runs for its head SHA, and report CI status plus merged/closed state.
 * `verified` derives ONLY from CI — never random, never assumed.
 * Accepts an injected `client` for tests.
 */
export async function verifyRepairPr(
  repository: string,
  prNumber: number,
  token?: string,
  client?: Pick<Octokit, 'rest'>,
): Promise<VerifyRepairPrResult> {
  const auth = token ?? process.env.GITHUB_TOKEN;
  if (!auth && !client) {
    throw new Error('GITHUB_TOKEN is not configured');
  }

  const octokit = client ?? (new Octokit({ auth }) as Pick<Octokit, 'rest'>);
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) throw new Error(`Invalid repository "${repository}" (want owner/repo)`);

  const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
  const headSha: string = pr.head.sha;
  const merged = pr.merged === true;
  const closed = pr.state === 'closed';

  // Check-runs are paginated: a later page may contain the failure, so every
  // page must be evaluated. Any retrieval error throws (fail closed).
  // A short page terminates the loop.
  const runs: Array<{ status: string | null; conclusion: string | null }> = [];
  const PAGE_SIZE = 100;
  for (let page = 1; ; page += 1) {
    const { data: checks } = await octokit.rest.checks.listForRef({
      owner,
      repo,
      ref: headSha,
      per_page: PAGE_SIZE,
      page,
    });
    const batch: Array<{ status: string | null; conclusion: string | null }> =
      checks.check_runs ?? [];
    runs.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  const ciPassed = runs.length > 0 && runs.every(r => r.status === 'completed' && r.conclusion === 'success');

  return { verified: ciPassed, ciPassed, merged, closed, headSha, checksTotal: runs.length };
}
