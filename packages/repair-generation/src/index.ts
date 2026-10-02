// @shapi/repair-generation - suggest fixes from diagnosis
import type { RepairChange } from './changes.js';
import { validateRepairChanges } from './changes.js';
export * from './changes.js';
export * from './business-outcome.js';
export * from './demo-saas-repair.js';

export interface Repair {
  type: 'CODE_CHANGE' | 'CONFIG_CHANGE' | 'WEBHOOK_RETRY' | 'MANUAL';
  description: string;
  diff: string | null;
  files: string[];
  repository?: string | null;
  confidence: number;
  /** structured, machine-applicable form of the fix; diff/files stay as the human-readable form */
  changes?: RepairChange[] | null;
}

export function suggestRepairs(opts: {
  predicateExpression: string;
  invariantName: string;
  rootCause: string;
  suggestedFix: string;
  hasRetryConfig: boolean;
  repairRepository?: string | null;
  repairFilePath?: string | null;
}): Repair[] {
  const out: Repair[] = [];
  const { predicateExpression, invariantName, rootCause, suggestedFix, hasRetryConfig, repairRepository, repairFilePath } = opts;
  const mappedPath = repairRepository && repairFilePath ? repairFilePath : null;

  if (predicateExpression.includes('payload.') && !predicateExpression.includes('?.')) {
    const fixed = predicateExpression.replace(/payload\.(\w+)/g, 'payload?.$1');
    const changes: RepairChange[] | null = mappedPath
      ? [{ kind: 'replace', path: mappedPath, before: predicateExpression, after: fixed }]
      : null;
    if (changes) validateRepairChanges(changes);
    out.push({
      type: 'CODE_CHANGE',
      description: 'Add optional chaining to predicate',
      diff: `- ${predicateExpression}\n+ ${fixed}`,
      files: mappedPath ? [mappedPath] : [],
      repository: mappedPath ? repairRepository : null,
      confidence: 0.7,
      changes,
    });
  }
  if (!hasRetryConfig) {
    out.push({
      type: 'WEBHOOK_RETRY',
      description: 'Add webhook retry with exponential backoff',
      diff: '+ retryAttempts: 3, retryDelay: 1000',
      files: ['integrations/config.json'],
      confidence: 0.8,
    });
  }
  if (rootCause.includes('webhook') || suggestedFix.includes('predicate')) {
    const predicateFile = mappedPath ? [mappedPath] : [`src/invariants/${invariantName}.ts`];
    const guarded = `event.type !== undefined && (${predicateExpression})`;
    const changes: RepairChange[] | null = mappedPath
      ? [{ kind: 'replace', path: mappedPath, before: predicateExpression, after: guarded }]
      : null;
    if (changes) validateRepairChanges(changes);
    out.push({
      type: 'CODE_CHANGE',
      description: 'Update predicate to handle new event format',
      diff: `- ${predicateExpression}\n+ ${guarded}`,
      files: predicateFile,
      repository: mappedPath ? repairRepository : null,
      confidence: 0.65,
      changes,
    });
  }
  if (out.length === 0) {
    out.push({
      type: 'MANUAL',
      description: 'Manual investigation required',
      diff: null,
      files: [],
      confidence: 0.2,
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}
