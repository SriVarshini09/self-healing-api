/**
 * Reviewed GitHub invariant predicates used by the local seed data.
 *
 * These expressions intentionally describe the expected event contract only;
 * they do not declare a repair target. A failing GitHub invariant remains a
 * manual-review candidate until its target behavior and repair are explicitly
 * reviewed.
 */
export const GITHUB_PR_MERGED_PREDICATE =
  "event.type === 'pull_request' && event.payload.action === 'closed' && event.payload.pull_request.merged === true && event.payload.pull_request.base.ref === 'main'";

export const GITHUB_WORKFLOW_SUCCESS_PREDICATE =
  "event.type === 'workflow_run' && event.payload.action === 'completed' && event.payload.workflow_run.conclusion === 'success'";
