// @shapi/drift-detection - statistical behavioral drift detection
export interface DriftConfig {
  baselineWindowDays?: number;
  detectionWindowHours?: number;
  minDetectionSamples?: number;
  significanceThreshold?: number;
  minEffectSize?: number;
}

export interface DriftInput {
  baselineSuccesses: number;
  baselineTrials: number;
  currentSuccesses: number;
  currentTrials: number;
}

export interface DriftOutput {
  detected: boolean;
  pValue: number;
  effectSize: number;
  baselineRate: number;
  currentRate: number;
}

export function normalCDF(x: number): number {
  // The polynomial below is only valid for x >= 0; use symmetry for the lower half.
  if (x < 0) return 1 - normalCDF(-x);
  const t = 1 / (1 + 0.2316419 * x);
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const prob =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - prob : prob;
}

export function proportionTest(
  successes: number,
  trials: number,
  baselineRate: number,
  baselineTrials = trials,
) {
  if (trials === 0) return { pValue: 1, effectSize: 0, currentRate: 0 };
  const currentRate = successes / trials;
  if (baselineTrials === 0) return { pValue: 1, effectSize: 0, currentRate };
  const pooled = (successes + baselineRate * baselineTrials) / (trials + baselineTrials);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / trials + 1 / baselineTrials));
  const z = se === 0 ? 0 : (currentRate - baselineRate) / se;
  const pValue = 2 * (1 - normalCDF(Math.abs(z)));
  const denom = Math.sqrt(Math.max(baselineRate * (1 - baselineRate), 1e-9));
  return { pValue, effectSize: (currentRate - baselineRate) / denom, currentRate };
}

export function detectDrift(input: DriftInput, cfg: DriftConfig = {}): DriftOutput {
  const significanceThreshold = cfg.significanceThreshold ?? 0.01;
  const minEffectSize = cfg.minEffectSize ?? 0.5;
  const baselineRate = input.baselineTrials === 0 ? 1 : input.baselineSuccesses / input.baselineTrials;
  const { pValue, effectSize, currentRate } = proportionTest(
    input.currentSuccesses,
    input.currentTrials,
    baselineRate,
    input.baselineTrials,
  );
  // Drift here means the outcome got WORSE. A significant improvement (for example right
  // after a fix) is not an incident, and must not open one that says the rate "dropped".
  const detected =
    input.currentTrials >= (cfg.minDetectionSamples ?? 1) &&
    currentRate < baselineRate &&
    pValue < significanceThreshold &&
    Math.abs(effectSize) >= minEffectSize;
  return { detected, pValue, effectSize, baselineRate, currentRate };
}

export type DriftSeverity = 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * How bad a drop is, in terms people understand: percentage points lost. (The effect size is
 * scaled by the baseline's variance, which explodes near 0% and 100%: a baseline of 100% made
 * even a 2% drop look "critical".)
 */
export function driftSeverity(baselineRate: number, currentRate: number): DriftSeverity {
  const drop = baselineRate - currentRate;
  if (drop >= 0.3) return 'CRITICAL';
  if (drop >= 0.1) return 'HIGH';
  return 'MEDIUM';
}
