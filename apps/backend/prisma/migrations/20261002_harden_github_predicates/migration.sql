-- Treat malformed GitHub webhook payloads as failed invariant samples rather
-- than evaluation errors. Keep the stored seed invariants aligned with the
-- reviewed predicates used by the application.
UPDATE "Invariant"
SET "predicateExpression" = 'event.type === ''pull_request'' && event.payload?.action === ''closed'' && event.payload?.pull_request?.merged === true && event.payload?.pull_request?.base?.ref === ''main'''
WHERE "id" = 'inv-github-pr-merged';

UPDATE "Invariant"
SET "predicateExpression" = 'event.type === ''workflow_run'' && event.payload?.action === ''completed'' && event.payload?.workflow_run?.conclusion === ''success'''
WHERE "id" = 'inv-github-workflow-success';
