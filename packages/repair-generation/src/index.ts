// @shapi/repair-generation - suggest fixes from diagnosis
export interface Repair {
  type: 'CODE_CHANGE' | 'CONFIG_CHANGE' | 'WEBHOOK_RETRY' | 'MANUAL';
  description: string;
  diff: string | null;
  files: string[];
  confidence: number;
}

export function suggestRepairs(opts: {
  predicateExpression: string;
  invariantName: string;
  rootCause: string;
  suggestedFix: string;
  hasRetryConfig: boolean;
}): Repair[] {
  const out: Repair[] = [];
  const { predicateExpression, invariantName, rootCause, suggestedFix, hasRetryConfig } = opts;

  if (predicateExpression.includes('payload.') && !predicateExpression.includes('?.')) {
    const fixed = predicateExpression.replace(/payload\.(\w+)/g, 'payload?.$1');
    out.push({
      type: 'CODE_CHANGE',
      description: 'Add optional chaining to predicate',
      diff: `- ${predicateExpression}\n+ ${fixed}`,
      files: [`invariants/${invariantName}.ts`],
      confidence: 0.7,
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
    out.push({
      type: 'CODE_CHANGE',
      description: 'Update predicate to handle new event format',
      diff: null,
      files: [`src/invariants/${invariantName}.ts`],
      confidence: 0.65,
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
