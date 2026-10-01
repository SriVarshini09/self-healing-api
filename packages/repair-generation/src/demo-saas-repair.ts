import type { RepairChange } from './changes.js';

/** Reviewed target coordinates for the repository's demo business-outcome proof. */
export const DEMO_SAAS_REPOSITORY = 'SriVarshini09/self-healing-api';
export const DEMO_SAAS_PROVISIONING_PATH = 'apps/demo-saas/src/business-outcome.ts';

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

export function isDemoSaasProvisioningTarget(
  repository: string | null | undefined,
  filePath: string | null | undefined,
): boolean {
  return repository === DEMO_SAAS_REPOSITORY && filePath === DEMO_SAAS_PROVISIONING_PATH;
}
