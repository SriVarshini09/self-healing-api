import { describe, expect, it } from 'vitest';
import { evaluatePredicate } from '@shapi/invariant-engine';
import {
  GITHUB_PR_MERGED_PREDICATE,
  GITHUB_WORKFLOW_SUCCESS_PREDICATE,
} from '../github-invariants.js';

const event = (type: string, payload: Record<string, unknown>) => ({
  type,
  payload,
  headers: {},
});

describe('reviewed GitHub invariants', () => {
  it('accepts a merged pull request targeting main', () => {
    const result = evaluatePredicate(GITHUB_PR_MERGED_PREDICATE, event('pull_request', {
      action: 'closed',
      pull_request: { merged: true, base: { ref: 'main' } },
    }));

    expect(result.passed).toBe(true);
  });

  it('rejects closed, unmerged, or non-main pull requests', () => {
    const cases = [
      { action: 'closed', pull_request: { merged: false, base: { ref: 'main' } } },
      { action: 'closed', pull_request: { merged: true, base: { ref: 'develop' } } },
      { action: 'opened', pull_request: { merged: false, base: { ref: 'main' } } },
    ];

    for (const payload of cases) {
      expect(evaluatePredicate(GITHUB_PR_MERGED_PREDICATE, event('pull_request', payload)).passed).toBe(false);
    }
  });

  it('accepts only completed successful workflow runs', () => {
    const success = evaluatePredicate(GITHUB_WORKFLOW_SUCCESS_PREDICATE, event('workflow_run', {
      action: 'completed',
      workflow_run: { conclusion: 'success' },
    }));
    const failure = evaluatePredicate(GITHUB_WORKFLOW_SUCCESS_PREDICATE, event('workflow_run', {
      action: 'completed',
      workflow_run: { conclusion: 'failure' },
    }));
    const inProgress = evaluatePredicate(GITHUB_WORKFLOW_SUCCESS_PREDICATE, event('workflow_run', {
      action: 'requested',
      workflow_run: { conclusion: null },
    }));

    expect(success.passed).toBe(true);
    expect(failure.passed).toBe(false);
    expect(inProgress.passed).toBe(false);
  });
});
