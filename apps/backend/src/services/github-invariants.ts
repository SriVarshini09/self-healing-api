/**
 * Reviewed GitHub invariant predicates used by the local seed data.
 *
 * These expressions describe the expected event contract and the reviewed
 * source location where predicate repairs may be proposed for this repository.
 * The target still requires the exact `verify` check; this is not a
 * business-outcome adapter and does not authorize an automatic merge.
 */
export const GITHUB_INVARIANT_REPAIR_REPOSITORY = 'SriVarshini09/self-healing-api';
export const GITHUB_INVARIANT_REPAIR_FILE_PATH = 'apps/backend/src/services/github-invariants.ts';
export const GITHUB_INVARIANT_REPAIR_REQUIRED_CHECKS = ['verify'] as const;

export const GITHUB_PR_MERGED_PREDICATE =
  "event.type === 'pull_request' && event.payload?.action === 'closed' && event.payload?.pull_request?.merged === true && event.payload?.pull_request?.base?.ref === 'main'";

export const GITHUB_WORKFLOW_SUCCESS_PREDICATE =
  "event.type === 'workflow_run' && event.payload?.action === 'completed' && event.payload?.workflow_run?.conclusion === 'success'";
