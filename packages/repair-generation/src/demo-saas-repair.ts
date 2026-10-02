import { validateRepairChanges, type RepairChange } from './changes.js';

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

/**
 * Validate the reviewed adapter catalog before it can authorize a business-
 * outcome repair. This is deliberately stricter than ordinary candidate
 * validation: a reviewed adapter must have a canonical target, a bounded
 * confidence, and a real structured change that touches that target.
 */
export function validateReviewedBusinessOutcomeAdapters(
  adapters: readonly ReviewedBusinessOutcomeAdapter[],
): void {
  const ids = new Set<string>();
  const targets = new Set<string>();

  if (!Array.isArray(adapters) || adapters.length === 0) {
    throw new Error('at least one reviewed business-outcome adapter is required');
  }

  for (const adapter of adapters) {
    if (!adapter.adapterId.trim() || ids.has(adapter.adapterId)) {
      throw new Error(`reviewed business-outcome adapter id must be unique: ${adapter.adapterId}`);
    }
    ids.add(adapter.adapterId);

    const target = `${adapter.repository}:${adapter.targetPath}`;
    if (!adapter.repository.trim() || !adapter.targetPath.trim() || targets.has(target)) {
      throw new Error(`reviewed business-outcome adapter target must be unique and non-empty: ${target}`);
    }
    targets.add(target);

    if (adapter.requiredCheck !== 'business-outcome') {
      throw new Error(`reviewed adapter ${adapter.adapterId} must require the business-outcome check`);
    }
    if (!adapter.description.trim() || !adapter.repair.description.trim() || !adapter.repair.diff.trim()) {
      throw new Error(`reviewed adapter ${adapter.adapterId} must describe its proof and repair`);
    }
    if (!Number.isFinite(adapter.repair.confidence) || adapter.repair.confidence < 0 || adapter.repair.confidence > 1) {
      throw new Error(`reviewed adapter ${adapter.adapterId} has invalid confidence`);
    }

    const changes = [...adapter.repair.changes];
    validateRepairChanges(changes);
    if (!changes.some(change => change.path === adapter.targetPath)) {
      throw new Error(`reviewed adapter ${adapter.adapterId} must change its declared target file`);
    }
    if (changes.some(change => change.kind === 'replace' && change.before === change.after)) {
      throw new Error(`reviewed adapter ${adapter.adapterId} contains a no-op replacement`);
    }
  }
}

validateReviewedBusinessOutcomeAdapters(REVIEWED_BUSINESS_OUTCOME_ADAPTERS);

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
