import { describe, expect, it } from 'vitest';
import {
  DEMO_SAAS_PROVISIONING_PATH,
  DEMO_SAAS_REPOSITORY,
} from '@shapi/repair-generation';
import { generateRepairCandidates } from '../repair.js';

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

function provisioningIncident(repairRepository: string | null, repairFilePath: string | null): Parameters<typeof generateRepairCandidates>[0] {
  return {
    invariant: {
      id: 'inv-stripe-provisioning',
      name: 'No Failed Provisioning Invariant',
      predicateExpression: "event.type !== 'provisioning.failed'",
      repairRepository,
      repairFilePath,
    },
    integration: { name: 'stripe', type: 'STRIPE', config: { retryAttempts: 3 } },
  } as unknown as Parameters<typeof generateRepairCandidates>[0];
}

describe('repair candidate repository mapping', () => {
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

  it('only generates the reviewed demo business-outcome patch for its exact target', async () => {
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
  });
});
