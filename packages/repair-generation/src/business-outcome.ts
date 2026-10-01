import { applyRepairChanges, type RepairChange } from './changes.js';

export interface BusinessOutcomeRepairContract<THandler, TState, TResult> {
  files: Record<string, string>;
  targetPath: string;
  changes: RepairChange[];
  load: (source: string) => THandler;
  createState: () => TState;
  run: (handler: THandler, state: TState) => TResult;
  reproducesFailure: (result: TResult, state: TState) => boolean;
  provesRecovery: (result: TResult, state: TState) => boolean;
}

export interface BusinessOutcomeRepairProof<TState, TResult> {
  before: { result: TResult; state: TState };
  after: { result: TResult; state: TState };
  patchedFiles: Record<string, string>;
}

/**
 * Apply a reviewed change set to a target-app source map and prove the
 * business outcome changes from the reproduced failure to recovery.
 *
 * The target adapter owns execution. SHAPI never evaluates arbitrary customer
 * code implicitly; a deployment must provide an explicit, reviewed contract
 * for loading the source, creating isolated state, running the event, and
 * identifying failure/recovery.
 */
export function proveBusinessOutcomeRepair<THandler, TState, TResult>(
  contract: BusinessOutcomeRepairContract<THandler, TState, TResult>,
): BusinessOutcomeRepairProof<TState, TResult> {
  const originalSource = contract.files[contract.targetPath];
  if (originalSource === undefined) {
    throw new Error(`business-outcome target file does not exist: ${contract.targetPath}`);
  }

  const beforeState = contract.createState();
  const beforeResult = contract.run(contract.load(originalSource), beforeState);
  if (!contract.reproducesFailure(beforeResult, beforeState)) {
    throw new Error('business-outcome contract did not reproduce the expected baseline failure');
  }

  const patchedFiles = applyRepairChanges(contract.files, contract.changes);
  const afterState = contract.createState();
  const afterResult = contract.run(contract.load(patchedFiles[contract.targetPath]), afterState);
  if (!contract.provesRecovery(afterResult, afterState)) {
    throw new Error('business-outcome contract did not prove recovery after the repair');
  }

  return {
    before: { result: beforeResult, state: beforeState },
    after: { result: afterResult, state: afterState },
    patchedFiles,
  };
}
