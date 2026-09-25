import { describe, it, expect } from 'vitest';
import { detectDrift } from './index.js';

describe('drift-detection', () => {
  it('detects strong regression', () => {
    const r = detectDrift(
      { baselineSuccesses: 990, baselineTrials: 1000, currentSuccesses: 70, currentTrials: 100 },
      { significanceThreshold: 0.01, minEffectSize: 0.5, minDetectionSamples: 50 },
    );
    expect(r.detected).toBe(true);
    expect(r.pValue).toBeLessThan(0.01);
  });

  it('does not flag healthy traffic', () => {
    const r = detectDrift(
      { baselineSuccesses: 990, baselineTrials: 1000, currentSuccesses: 99, currentTrials: 100 },
      { significanceThreshold: 0.01, minEffectSize: 0.5, minDetectionSamples: 50 },
    );
    expect(r.detected).toBe(false);
  });

  it('requires minimum samples', () => {
    const r = detectDrift(
      { baselineSuccesses: 99, baselineTrials: 100, currentSuccesses: 1, currentTrials: 5 },
      { minDetectionSamples: 50 },
    );
    expect(r.detected).toBe(false);
  });
});
