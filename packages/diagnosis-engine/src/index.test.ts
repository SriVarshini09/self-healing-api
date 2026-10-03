import { describe, it, expect } from 'vitest';
import { diagnose } from './index.js';

describe('diagnosis-engine', () => {
  it('flags high failure rate', () => {
    const d = diagnose({ failureRate: 0.5, failedCount: 50, totalCount: 100, expectedSuccessRate: 0.99, actualSuccessRate: 0.5 });
    expect(d.confidence).toBeGreaterThanOrEqual(0.8);
  });
  it('flags drift', () => {
    const d = diagnose({ failureRate: 0, failedCount: 0, totalCount: 100, expectedSuccessRate: 0.99, actualSuccessRate: 0.99, drift: { baselineRate: 0.99, currentRate: 0.7, pValue: 0.001 } });
    expect(d.rootCause).toContain('drift');
  });
  it('prioritizes tracked business-outcome failures over transport signals', () => {
    const d = diagnose({
      failureRate: 0.5,
      failedCount: 50,
      totalCount: 100,
      expectedSuccessRate: 0.99,
      actualSuccessRate: 0.5,
      failedOutcomes: { count: 3, latestType: 'provisioning.failed', latestReason: 'provisioning skipped (simulated bug)' },
    });
    expect(d.confidence).toBeGreaterThanOrEqual(0.9);
    expect(d.rootCause).toContain('provisioning.failed');
    expect(d.rootCause).toContain('provisioning skipped');
  });
});
