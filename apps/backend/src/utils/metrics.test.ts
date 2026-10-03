import { describe, expect, it } from 'vitest';
import { isMetricsTokenValid } from './metrics.js';

describe('isMetricsTokenValid', () => {
  it('accepts the exact configured token', () => {
    expect(isMetricsTokenValid('metrics-secret', 'metrics-secret')).toBe(true);
  });

  it('rejects missing, wrong, or differently sized tokens', () => {
    expect(isMetricsTokenValid(undefined, 'metrics-secret')).toBe(false);
    expect(isMetricsTokenValid('wrong', 'metrics-secret')).toBe(false);
    expect(isMetricsTokenValid('metrics-secret', undefined)).toBe(false);
  });
});
