import { describe, expect, it } from 'vitest';
import {
  DEMO_SAAS_PROVISIONING_PATH,
  DEMO_SAAS_REPOSITORY,
} from '@shapi/repair-generation';
import { generateRepairCandidates, repairCandidateReadiness } from '../repair.js';

const diagnosis = { rootCause: 'Changed payload', suggestedFix: 'Review predicate', confidence: 0.8, evidence: [] };

function incident(repairRepository: string | null, repairFilePath: string | null): Parameters<typeof generateRepairCandidates>[0] {
  return {
    invariant: {
      name: 'payment',
      predicateExpression: 'event.payload.amount > 0',
      repairRepository,
      repairFilePath,
    },
    integration: { name: 'stripe', type: 'STRIPE', config: { retryAttempts: 3 } },
  } as unknown as Parameters<typeof generateRepairCandidates>[0];
}

function provisioningIncident(
  repairRepository: string | null,
  repairFilePath: string | null,
  id = 'inv-stripe-provisioning',
): Parameters<typeof generateRepairCandidates>[0] {
  return {
    invariant: {
      id,
      name: 'No Failed Provisioning Invariant',
      predicateExpression: "event.type !== 'provisioning.failed'",
      repairRepository,
      repairFilePath,
    },
    integration: { name: 'stripe', type: 'STRIPE', config: { retryAttempts: 3 } },
  } as unknown as Parameters<typeof generateRepairCandidates>[0];
}

describe('repair candidate repository mapping', () => {
  it('marks an unmapped candidate for manual review', () => {
    expect(repairCandidateReadiness({ repository: null, changes: [{ kind: 'replace' }] }, ['verify'])).toEqual({
      reviewStatus: 'MANUAL_REVIEW',
      automationEligible: false,
      reviewReason: 'No repository mapping is configured',
      requiredChecks: ['verify'],
    });
  });

  it('marks a mapped candidate without structured changes for manual review', () => {
    expect(repairCandidateReadiness({ repository: 'acme/demo', changes: null }, ['verify'])).toMatchObject({
      reviewStatus: 'MANUAL_REVIEW',
      automationEligible: false,
      reviewReason: 'No structured file changes are available',
    });
  });

  it('requires an exact target check before a candidate is automation eligible', () => {
    expect(repairCandidateReadiness({ repository: 'acme/demo', changes: [{ kind: 'replace' }] }, [])).toMatchObject({
      reviewStatus: 'MANUAL_REVIEW',
      automationEligible: false,
      reviewReason: 'No required GitHub checks are configured',
      requiredChecks: [],
    });
  });

  it('marks a fully configured candidate PR-ready after operator review', () => {
    expect(repairCandidateReadiness({ repository: 'acme/demo', changes: [{ kind: 'replace' }] }, ['verify'])).toEqual({
      reviewStatus: 'PR_READY_AFTER_REVIEW',
      automationEligible: true,
      reviewReason: 'Structured patch, repository mapping, and required checks are configured',
      requiredChecks: ['verify'],
    });
  });

  it('keeps the reviewed demo business-outcome candidate manual without its dedicated check', () => {
    const candidate = {
      repository: DEMO_SAAS_REPOSITORY,
      files: [DEMO_SAAS_PROVISIONING_PATH],
      changes: [{ kind: 'replace' }],
    };

    expect(repairCandidateReadiness(candidate, ['verify'])).toMatchObject({
      reviewStatus: 'MANUAL_REVIEW',
      automationEligible: false,
      reviewReason: 'The reviewed demo-saas-provisioning adapter requires the business-outcome check',
      requiredChecks: ['verify'],
    });
    expect(repairCandidateReadiness(candidate, ['verify', 'business-outcome'])).toMatchObject({
      reviewStatus: 'PR_READY_AFTER_REVIEW',
      automationEligible: true,
    });
  });

  it('keeps unmapped predicate suggestions manual', async () => {
    const candidates = await generateRepairCandidates(incident(null, null), diagnosis);
    const predicate = candidates.find(candidate => candidate.description.includes('optional chaining'));
    expect(predicate).toMatchObject({ files: [], repository: null });
    expect(predicate?.changes).toBeUndefined();
  });

  it('uses an explicitly mapped file for a structured candidate', async () => {
    const candidates = await generateRepairCandidates(incident('acme/demo', 'src/invariants/payment.ts'), diagnosis);
    const predicate = candidates.find(candidate => candidate.description.includes('optional chaining'));
    expect(predicate).toMatchObject({
      repository: 'acme/demo',
      files: ['src/invariants/payment.ts'],
      changes: [{ kind: 'replace', path: 'src/invariants/payment.ts', before: 'event.payload.amount > 0' }],
    });
  });

  it('makes every nested payload segment null-safe', async () => {
    const candidates = await generateRepairCandidates(incident('acme/demo', 'src/invariants/payment.ts'), {
      ...diagnosis,
      rootCause: 'Changed nested payload',
    });
    const predicate = candidates.find(candidate => candidate.description.includes('optional chaining'));
    expect(predicate?.changes).toEqual([{
      kind: 'replace',
      path: 'src/invariants/payment.ts',
      before: 'event.payload.amount > 0',
      after: 'event.payload?.amount > 0',
    }]);

    const nestedCandidates = await generateRepairCandidates({
      invariant: {
        name: 'nested payment',
        predicateExpression: 'event.payload.data.object.amount > 0',
        repairRepository: 'acme/demo',
        repairFilePath: 'src/invariants/payment.ts',
      },
      integration: { name: 'stripe', type: 'STRIPE', config: { retryAttempts: 3 } },
    } as unknown as Parameters<typeof generateRepairCandidates>[0], diagnosis);
    const nestedPredicate = nestedCandidates.find(candidate => candidate.description.includes('optional chaining'));
    expect(nestedPredicate?.changes).toEqual([{
      kind: 'replace',
      path: 'src/invariants/payment.ts',
      before: 'event.payload.data.object.amount > 0',
      after: 'event.payload?.data?.object?.amount > 0',
    }]);
  });

  it('creates a structured event guard for an explicitly mapped predicate', async () => {
    const candidates = await generateRepairCandidates({
      invariant: {
        name: 'workflow',
        predicateExpression: "action === 'completed'",
        repairRepository: 'acme/demo',
        repairFilePath: 'src/invariants/workflow.ts',
      },
      integration: { name: 'github', type: 'GITHUB', config: { retryAttempts: 3 } },
    } as unknown as Parameters<typeof generateRepairCandidates>[0], diagnosis);
    const predicate = candidates.find(candidate => candidate.description.includes('event type guard'));
    expect(predicate).toMatchObject({
      repository: 'acme/demo',
      files: ['src/invariants/workflow.ts'],
      changes: [{
        kind: 'replace',
        path: 'src/invariants/workflow.ts',
        before: "action === 'completed'",
        after: "event.type !== undefined && (action === 'completed')",
      }],
    });
  });

  it('only generates the reviewed business-outcome patch for its exact target', async () => {
    const unmapped = await generateRepairCandidates(provisioningIncident(null, null), diagnosis);
    expect(unmapped.find(candidate => candidate.description.includes('silent provisioning'))).toBeUndefined();

    const mapped = await generateRepairCandidates(
      provisioningIncident(DEMO_SAAS_REPOSITORY, DEMO_SAAS_PROVISIONING_PATH),
      diagnosis,
    );
    expect(mapped.find(candidate => candidate.description.includes('silent provisioning'))).toMatchObject({
      repository: DEMO_SAAS_REPOSITORY,
      files: [DEMO_SAAS_PROVISIONING_PATH],
      confidence: 0.95,
      changes: [{ kind: 'replace', path: DEMO_SAAS_PROVISIONING_PATH }],
    });

    const renamed = await generateRepairCandidates(
      provisioningIncident(DEMO_SAAS_REPOSITORY, DEMO_SAAS_PROVISIONING_PATH, 'customer-renamed-invariant'),
      diagnosis,
    );
    expect(renamed.find(candidate => candidate.description.includes('silent provisioning'))).toMatchObject({
      repository: DEMO_SAAS_REPOSITORY,
      files: [DEMO_SAAS_PROVISIONING_PATH],
    });
  });
});
