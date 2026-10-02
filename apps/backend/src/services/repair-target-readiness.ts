import {
  DEMO_SAAS_PROVISIONING_PATH,
  DEMO_SAAS_REPOSITORY,
  isDemoSaasProvisioningTarget,
} from '@shapi/repair-generation';

export type RepairTargetReadinessState =
  | 'MANUAL_REVIEW'
  | 'BLOCKED_NO_REQUIRED_CHECKS'
  | 'BLOCKED_MISSING_BUSINESS_OUTCOME_CHECK'
  | 'READY_FOR_TARGET_REVIEW';

export interface RepairTargetReadiness {
  state: RepairTargetReadinessState;
  reason: string;
  requiredChecks: string[];
}

type RepairTargetInvariant = {
  id: string;
  repairRepository: string | null;
  repairFilePath: string | null;
  repairRequiredChecks: string[];
};

export function repairTargetReadiness(invariant: RepairTargetInvariant): RepairTargetReadiness {
  const requiredChecks = [...new Set(invariant.repairRequiredChecks.map(check => check.trim()).filter(Boolean))];
  const mapped = Boolean(invariant.repairRepository && invariant.repairFilePath);

  if (!mapped) {
    return {
      state: 'MANUAL_REVIEW',
      reason: 'Map a repository and file path before SHAPI can propose a repair.',
      requiredChecks,
    };
  }

  if (requiredChecks.length === 0) {
    return {
      state: 'BLOCKED_NO_REQUIRED_CHECKS',
      reason: 'Add at least one exact GitHub check before this target can be reviewed.',
      requiredChecks,
    };
  }

  if (
    invariant.id === 'inv-stripe-provisioning' &&
    isDemoSaasProvisioningTarget(invariant.repairRepository, invariant.repairFilePath) &&
    !requiredChecks.includes('business-outcome')
  ) {
    return {
      state: 'BLOCKED_MISSING_BUSINESS_OUTCOME_CHECK',
      reason: `This reviewed adapter requires the business-outcome check for ${DEMO_SAAS_REPOSITORY}/${DEMO_SAAS_PROVISIONING_PATH}.`,
      requiredChecks,
    };
  }

  return {
    state: 'READY_FOR_TARGET_REVIEW',
    reason: 'Repository, file path, and required checks are configured for human target review.',
    requiredChecks,
  };
}
