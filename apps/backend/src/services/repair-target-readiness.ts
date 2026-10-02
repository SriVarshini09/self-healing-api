import { reviewedBusinessOutcomeAdapter } from '@shapi/repair-generation';

export type RepairTargetReadinessState =
  | 'MANUAL_REVIEW'
  | 'BLOCKED_NO_REQUIRED_CHECKS'
  | 'BLOCKED_MISSING_BUSINESS_OUTCOME_CHECK'
  | 'READY_FOR_TARGET_REVIEW';

export interface RepairTargetReadiness {
  state: RepairTargetReadinessState;
  reason: string;
  requiredChecks: string[];
  adapterId: string | null;
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
  const adapter = reviewedBusinessOutcomeAdapter(invariant.repairRepository, invariant.repairFilePath);

  if (!mapped) {
    return {
      state: 'MANUAL_REVIEW',
      reason: 'Map a repository and file path before SHAPI can propose a repair.',
      requiredChecks,
      adapterId: null,
    };
  }

  if (requiredChecks.length === 0) {
    return {
      state: 'BLOCKED_NO_REQUIRED_CHECKS',
      reason: 'Add at least one exact GitHub check before this target can be reviewed.',
      requiredChecks,
      adapterId: adapter?.adapterId ?? null,
    };
  }

  if (adapter && !requiredChecks.includes(adapter.requiredCheck)) {
    return {
      state: 'BLOCKED_MISSING_BUSINESS_OUTCOME_CHECK',
      reason: `The reviewed ${adapter.adapterId} adapter requires the ${adapter.requiredCheck} check for ${adapter.repository}/${adapter.targetPath}.`,
      requiredChecks,
      adapterId: adapter.adapterId,
    };
  }

  return {
    state: 'READY_FOR_TARGET_REVIEW',
    reason: 'Repository, file path, and required checks are configured for human target review.',
    requiredChecks,
    adapterId: adapter?.adapterId ?? null,
  };
}
