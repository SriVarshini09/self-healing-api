import { describe, it, expect } from 'vitest';
import { suggestRepairs } from './index.js';

describe('repair-generation', () => {
  it('suggests optional chaining + retry', () => {
    const r = suggestRepairs({
      predicateExpression: 'event.payload.amount > 0',
      invariantName: 'pay',
      rootCause: 'webhook failures',
      suggestedFix: 'fix predicate',
      hasRetryConfig: false,
    });
    expect(r.length).toBeGreaterThanOrEqual(2);
    expect(r[0].confidence).toBeGreaterThanOrEqual(r[1].confidence);
  });
});
