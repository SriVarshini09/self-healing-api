import { describe, expect, it } from 'vitest';
import { repairTargetReadiness } from '../repair-target-readiness.js';

const base = {
  id: 'inv-test',
  repairRepository: null as string | null,
  repairFilePath: null as string | null,
  repairRequiredChecks: [] as string[],
};

describe('repairTargetReadiness', () => {
  it('keeps unmapped invariants in manual review', () => {
    expect(repairTargetReadiness(base)).toMatchObject({
      state: 'MANUAL_REVIEW',
      reason: expect.stringContaining('Map a repository'),
      adapterId: null,
    });
  });

  it('blocks mapped targets without required checks', () => {
    expect(repairTargetReadiness({
      ...base,
      repairRepository: 'acme/demo',
      repairFilePath: 'src/invariants/payments.ts',
    })).toMatchObject({
      state: 'BLOCKED_NO_REQUIRED_CHECKS',
      reason: expect.stringContaining('exact GitHub check'),
      adapterId: null,
    });
  });

  it('requires business-outcome for the reviewed provisioning adapter', () => {
    const target = {
      ...base,
      id: 'customer-renamed-invariant',
      repairRepository: 'SriVarshini09/self-healing-api',
      repairFilePath: 'apps/demo-saas/src/business-outcome.ts',
      repairRequiredChecks: ['verify'],
    };
    expect(repairTargetReadiness(target)).toMatchObject({
      state: 'BLOCKED_MISSING_BUSINESS_OUTCOME_CHECK',
      adapterId: 'demo-saas-provisioning',
    });
    expect(repairTargetReadiness({ ...target, repairRequiredChecks: ['verify', 'business-outcome'] })).toMatchObject({
      state: 'READY_FOR_TARGET_REVIEW',
      requiredChecks: ['verify', 'business-outcome'],
      adapterId: 'demo-saas-provisioning',
    });
  });
});
