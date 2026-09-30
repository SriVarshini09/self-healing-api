import { describe, expect, it } from 'vitest';
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
});
