import { describe, it, expect } from 'vitest';
import { detectDrift, driftSeverity, normalCDF } from './index.js';

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

  it('does not flag a significant improvement as drift', () => {
    const r = detectDrift(
      { baselineSuccesses: 700, baselineTrials: 1000, currentSuccesses: 99, currentTrials: 100 },
      { significanceThreshold: 0.01, minEffectSize: 0.5, minDetectionSamples: 50 },
    );
    expect(r.currentRate).toBeGreaterThan(r.baselineRate);
    expect(r.pValue).toBeLessThan(0.01);
    expect(r.detected).toBe(false);
  });

  it('computes the normal CDF correctly on both sides of zero', () => {
    expect(normalCDF(0)).toBeCloseTo(0.5, 5);
    expect(normalCDF(1)).toBeCloseTo(0.8413, 3);
    expect(normalCDF(-1)).toBeCloseTo(0.1587, 3);
    expect(normalCDF(-3)).toBeCloseTo(0.00135, 4);
    expect(normalCDF(-5)).toBeGreaterThanOrEqual(0);
  });

  it('grades severity by percentage points lost, not by the baseline-scaled effect size', () => {
    expect(driftSeverity(1, 0.98)).toBe('MEDIUM');
    expect(driftSeverity(0.99, 0.85)).toBe('HIGH');
    expect(driftSeverity(0.99, 0.6)).toBe('CRITICAL');
  });

  it('requires minimum samples', () => {
    const r = detectDrift(
      { baselineSuccesses: 99, baselineTrials: 100, currentSuccesses: 1, currentTrials: 5 },
      { minDetectionSamples: 50 },
    );
    expect(r.detected).toBe(false);
  });
});
