import { describe, expect, it } from 'vitest';
import { evaluatePredicate } from '@shapi/invariant-engine';
import {
  GITHUB_INVARIANT_REPAIR_FILE_PATH,
  GITHUB_INVARIANT_REPAIR_REPOSITORY,
  GITHUB_INVARIANT_REPAIR_REQUIRED_CHECKS,
  GITHUB_PR_MERGED_PREDICATE,
  GITHUB_WORKFLOW_SUCCESS_PREDICATE,
} from '../github-invariants.js';

const event = (type: string, payload: Record<string, unknown>) => ({
  type,
  payload,
  headers: {},
});

describe('reviewed GitHub invariants', () => {
  it('declares the reviewed repository target and verify gate', () => {
    expect({
      repository: GITHUB_INVARIANT_REPAIR_REPOSITORY,
      filePath: GITHUB_INVARIANT_REPAIR_FILE_PATH,
      requiredChecks: [...GITHUB_INVARIANT_REPAIR_REQUIRED_CHECKS],
    }).toEqual({
      repository: 'SriVarshini09/self-healing-api',
      filePath: 'apps/backend/src/services/github-invariants.ts',
      requiredChecks: ['verify'],
    });
  });

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

  it('fails closed without throwing for incomplete pull request payloads', () => {
    const cases = [
      {},
      { action: 'closed' },
      { action: 'closed', pull_request: {} },
      { action: 'closed', pull_request: { merged: true } },
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

  it('fails closed without throwing for incomplete workflow payloads', () => {
    const cases = [{}, { action: 'completed' }, { action: 'completed', workflow_run: {} }];

    for (const payload of cases) {
      expect(evaluatePredicate(GITHUB_WORKFLOW_SUCCESS_PREDICATE, event('workflow_run', payload)).passed).toBe(false);
    }
  });
});
