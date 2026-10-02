import type { RepairChange } from './changes.js';

/** Reviewed target coordinates for the repository's demo business-outcome proof. */
export const DEMO_SAAS_REPOSITORY = 'SriVarshini09/self-healing-api';
export const DEMO_SAAS_PROVISIONING_PATH = 'apps/demo-saas/src/business-outcome.ts';
export const DEMO_SAAS_PROVISIONING_ADAPTER_ID = 'demo-saas-provisioning';

export const DEMO_SAAS_PROVISIONING_BEFORE = [
  '  if (failureMode) {',
  '    return {',
  '      success: false,',
  "      details: { reason: 'provisioning skipped (simulated bug)', customer },",
  '    };',
  '  }',
].join('\n') + '\n';

export const DEMO_SAAS_PROVISIONING_AFTER = [
  '  // The reviewed repair removes the silent failure branch so payment',
  "  // processing applies the user's provisioning outcome.",
].join('\n') + '\n';

export const DEMO_SAAS_PROVISIONING_REPAIR: RepairChange[] = [{
  kind: 'replace',
  path: DEMO_SAAS_PROVISIONING_PATH,
  before: DEMO_SAAS_PROVISIONING_BEFORE,
  after: DEMO_SAAS_PROVISIONING_AFTER,
}];

export interface ReviewedBusinessOutcomeAdapter {
  adapterId: string;
  repository: string;
  targetPath: string;
  requiredCheck: 'business-outcome';
  description: string;
  repair: {
    description: string;
    diff: string;
    confidence: number;
    changes: readonly RepairChange[];
  };
}

/**
 * Explicitly reviewed target adapters. Customer repositories are never
 * treated as business-outcome targets unless they are added here with their
 * own proof contract and required check.
 */
export const REVIEWED_BUSINESS_OUTCOME_ADAPTERS: readonly ReviewedBusinessOutcomeAdapter[] = [
  {
    adapterId: DEMO_SAAS_PROVISIONING_ADAPTER_ID,
    repository: DEMO_SAAS_REPOSITORY,
    targetPath: DEMO_SAAS_PROVISIONING_PATH,
    requiredCheck: 'business-outcome',
    description: 'Demo SaaS payment provisioning outcome',
    repair: {
      description: 'Remove the reviewed silent provisioning failure branch',
      diff: `- ${DEMO_SAAS_PROVISIONING_BEFORE.trimEnd().replace(/\n/gu, '\n- ')}\n+ ${DEMO_SAAS_PROVISIONING_AFTER.trimEnd().replace(/\n/gu, '\n+ ')}`,
      confidence: 0.95,
      changes: DEMO_SAAS_PROVISIONING_REPAIR,
    },
  },
];

export function reviewedBusinessOutcomeAdapter(
  repository: string | null | undefined,
  filePath: string | null | undefined,
): ReviewedBusinessOutcomeAdapter | null {
  return REVIEWED_BUSINESS_OUTCOME_ADAPTERS.find(adapter =>
    adapter.repository === repository && adapter.targetPath === filePath) ?? null;
}

export function isDemoSaasProvisioningTarget(
  repository: string | null | undefined,
  filePath: string | null | undefined,
): boolean {
  return reviewedBusinessOutcomeAdapter(repository, filePath)?.adapterId === DEMO_SAAS_PROVISIONING_ADAPTER_ID;
}
