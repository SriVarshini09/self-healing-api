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
    expect(r.find(candidate => candidate.description.includes('optional chaining'))?.changes).toBeNull();
  });

  it('generates an exact replacement only for an explicitly mapped repository file', () => {
    const repairs = suggestRepairs({
      predicateExpression: 'event.payload.amount > 0',
      invariantName: 'pay',
      rootCause: 'changed payload',
      suggestedFix: 'review predicate',
      hasRetryConfig: true,
      repairRepository: 'acme/demo',
      repairFilePath: 'src/invariants/pay.ts',
    });
    expect(repairs[0]).toMatchObject({
      repository: 'acme/demo',
      files: ['src/invariants/pay.ts'],
      changes: [{ kind: 'replace', path: 'src/invariants/pay.ts', before: 'event.payload.amount > 0' }],
    });
  });

  it('generates a structured event guard for an explicitly mapped predicate', () => {
    const repairs = suggestRepairs({
      predicateExpression: "payload.action === 'completed'",
      invariantName: 'workflow',
      rootCause: 'webhook failures',
      suggestedFix: 'review predicate',
      hasRetryConfig: true,
      repairRepository: 'acme/demo',
      repairFilePath: 'src/invariants/workflow.ts',
    });
    expect(repairs.find(candidate => candidate.description.includes('event format'))).toMatchObject({
      repository: 'acme/demo',
      files: ['src/invariants/workflow.ts'],
      changes: [{
        kind: 'replace',
        path: 'src/invariants/workflow.ts',
        before: "payload.action === 'completed'",
        after: "event.type !== undefined && (payload.action === 'completed')",
      }],
    });
  });

  it('does not wrap an already event-guarded predicate', () => {
    const repairs = suggestRepairs({
      predicateExpression: "event.type === 'workflow_run'",
      invariantName: 'workflow',
      rootCause: 'webhook failures',
      suggestedFix: 'review predicate',
      hasRetryConfig: true,
      repairRepository: 'acme/demo',
      repairFilePath: 'src/invariants/workflow.ts',
    });
    expect(repairs.find(candidate => candidate.description.includes('event format'))).toBeUndefined();
  });
});
