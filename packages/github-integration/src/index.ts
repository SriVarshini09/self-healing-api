// @shapi/github-integration - verified PR workflow helpers
import crypto from 'crypto';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { applyRepairChanges, RepairChangeError, validateRepairChanges, type RepairChange } from '@shapi/repair-generation';
export { RepairChangeError } from '@shapi/repair-generation';

type InstallationId = number | string;

function normalizedPrivateKey(value: string): string {
  return value.replace(/\\n/g, '\n');
}

export function hasGitHubAppCredentials(installationId?: InstallationId): boolean {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const numericInstallationId = Number(installationId);
  return Boolean(appId && privateKey && Number.isSafeInteger(numericInstallationId) && numericInstallationId > 0);
}

function createGitHubClient(
  token?: string,
  installationId?: InstallationId,
): Pick<Octokit, 'rest'> | null {
  if (token) return new Octokit({ auth: token });

  if (hasGitHubAppCredentials(installationId)) {
    return new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: process.env.GITHUB_APP_ID!,
        privateKey: normalizedPrivateKey(process.env.GITHUB_APP_PRIVATE_KEY!),
        installationId: Number(installationId),
      },
    });
  }

  if (process.env.GITHUB_TOKEN) return new Octokit({ auth: process.env.GITHUB_TOKEN });
  return null;
}

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
    `## SHAPI Proposed Repair`,
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
    `> A 200 OK does not prove success. This proposed repair came from a behavioral invariant violation. Review and test the change before merging.`,
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
  baseSha?: string;
  allowExistingBranch?: boolean;
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
  installationId?: InstallationId,
): Promise<PullRequestVerificationResult> {
  const octokit = client ?? createGitHubClient(token, installationId);
  if (!octokit) throw new Error('GitHub token or App installation credentials are required for real PR verification');
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
  // A PR with no check runs has not been verified. Do not let Array.every's
  // empty-list behavior turn missing CI evidence into a green result.
  const ciPassed = checks.total_count > 0 && !failed && checks.check_runs.every(check => check.status === 'completed');
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
 * Open a repair PR on GitHub. Lower-level helper retained for callers that
 * already have complete file contents; the incident route uses
 * `openRepairPrFromChanges` to verify and apply persisted changes first.
 * Without credentials this helper returns a simulated PR for local demos.
 */
export async function openRepairPr(
  opts: OpenRepairPrOptions,
  token?: string,
  client?: Pick<Octokit, 'rest'>,
  installationId?: InstallationId,
): Promise<OpenRepairPrResult> {
  const octokit = client ?? createGitHubClient(token, installationId);
  if (!octokit) {
    const prNumber = Math.floor(Math.random() * 10000) + 1;
    return { prNumber, prUrl: `https://github.com/${opts.repository}/pull/${prNumber}`, real: false };
  }

  const [owner, repo] = opts.repository.split('/');
  if (!owner || !repo) throw new Error(`Invalid repository "${opts.repository}" (want owner/repo)`);
  // Never assume 'main': discover the repository's actual default branch
  // unless the caller pinned one explicitly.
  const base = opts.base ?? (await octokit.rest.repos.get({ owner, repo })).data.default_branch;

  const baseSha = opts.baseSha ?? (await octokit.rest.git.getRef({ owner, repo, ref: `heads/${base}` })).data.object.sha;

  try {
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${opts.branch}`,
      sha: baseSha,
    });
  } catch (e: any) {
    if (e?.status !== 422) throw e;
    if (opts.allowExistingBranch === false) {
      throw new RepairChangeError('invalid-change', -1, `repair branch already exists: ${opts.branch}`);
    }
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

export interface RepairChangePreview {
  base: string;
  baseSha: string;
  files: Array<{ path: string; kind: RepairChange['kind']; original: string | null; content: string }>;
}

/** Read and validate stored changes against one pinned base commit, without writing to GitHub. */
export async function previewRepairPrChanges(
  opts: { repository: string; base?: string; changes: RepairChange[] },
  token?: string,
  client?: Pick<Octokit, 'rest'>,
  installationId?: InstallationId,
): Promise<RepairChangePreview> {
  validateRepairChanges(opts.changes);
  const octokit = client ?? createGitHubClient(token, installationId);
  if (!octokit) throw new Error('GitHub credentials are required to apply repair changes');
  const [owner, repo] = opts.repository.split('/');
  if (!owner || !repo) throw new Error(`Invalid repository "${opts.repository}" (want owner/repo)`);
  const base = opts.base ?? (await octokit.rest.repos.get({ owner, repo })).data.default_branch;
  const baseSha = (await octokit.rest.git.getRef({ owner, repo, ref: `heads/${base}` })).data.object.sha;
  const originals: Record<string, string> = Object.create(null) as Record<string, string>;

  for (const [index, change] of opts.changes.entries()) {
    try {
      const { data } = await octokit.rest.repos.getContent({ owner, repo, path: change.path, ref: baseSha });
      if (Array.isArray(data) || data.type !== 'file' || data.encoding !== 'base64' || typeof data.content !== 'string') {
        throw new RepairChangeError('invalid-change', index, `cannot read UTF-8 file: ${change.path}`);
      }
      const content = Buffer.from(data.content.replace(/\s/g, ''), 'base64');
      const decoded = content.toString('utf8');
      if (!content.equals(Buffer.from(decoded, 'utf8'))) {
        throw new RepairChangeError('invalid-change', index, `file is not UTF-8 text: ${change.path}`);
      }
      originals[change.path] = decoded;
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'status' in error && error.status === 404) {
        continue;
      }
      throw error;
    }
  }

  const updated = applyRepairChanges(originals, opts.changes);
  return {
    base,
    baseSha,
    files: opts.changes.map(change => ({
      path: change.path,
      kind: change.kind,
      original: originals[change.path] ?? null,
      content: updated[change.path],
    })),
  };
}

/** Resolve an exact stored change set against the target repository before opening a PR. */
export async function openRepairPrFromChanges(
  opts: Omit<OpenRepairPrOptions, 'files'> & { changes: RepairChange[] },
  token?: string,
  client?: Pick<Octokit, 'rest'>,
  installationId?: InstallationId,
): Promise<OpenRepairPrResult> {
  const octokit = client ?? createGitHubClient(token, installationId);
  if (!octokit) throw new Error('GitHub credentials are required to apply repair changes');
  const preview = await previewRepairPrChanges({
    repository: opts.repository,
    ...(opts.base ? { base: opts.base } : {}),
    changes: opts.changes,
  }, token, octokit, installationId);
  return openRepairPr({
    repository: opts.repository,
    title: opts.title,
    body: opts.body,
    branch: opts.branch,
    base: preview.base,
    baseSha: preview.baseSha,
    allowExistingBranch: false,
    files: preview.files.map(file => ({ path: file.path, content: file.content })),
  }, token, octokit, installationId);
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
  installationId?: InstallationId,
): Promise<VerifyRepairPrResult> {
  const octokit = client ?? createGitHubClient(token, installationId);
  if (!octokit) throw new Error('GitHub token or App installation credentials are required');
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
