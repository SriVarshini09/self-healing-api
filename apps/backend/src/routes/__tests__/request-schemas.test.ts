import { describe, expect, it } from 'vitest';
import { containsNullByte, urlContainsNullByte } from '../../utils/null-bytes.js';
import { driftConfigSchema, firstProblem, invariantCreateSchema, invariantEvaluateSchema, invariantPatchSchema } from '../request-schemas.js';

describe('invariant request bodies', () => {
  const valid = { integrationId: 'int-1', name: 'Paid customers', predicateExpression: "event.type === 'x'" };

  it('accepts what the dashboard, the provisioning script and the API docs send', () => {
    expect(invariantCreateSchema.safeParse(valid).success).toBe(true);
    expect(invariantCreateSchema.safeParse({
      ...valid, description: 'd', predicateDescription: 'p', predicateExample: 'e', repairRepository: 'acme/app',
      repairFilePath: 'src/a.ts', repairRequiredChecks: ['verify'], evaluationWindowSec: 300, minSamples: 10, expectedSuccessRate: 0.99,
    }).success).toBe(true);
    // form fields arrive as strings
    const fromForm = invariantCreateSchema.parse({ ...valid, evaluationWindowSec: '300', minSamples: '10', expectedSuccessRate: '0.99' });
    expect(fromForm).toMatchObject({ evaluationWindowSec: 300, minSamples: 10, expectedSuccessRate: 0.99 });
  });

  it('refuses unknown fields instead of passing them to the database (mass assignment)', () => {
    for (const extra of [
      { integrationId: 'another' },
      { status: 'HEALTHY' },
      { id: 'x' },
      { integration: { connect: { id: 'victim-integration' } } },
      { incidents: { deleteMany: {} } },
      { website: 'x' },
    ]) {
      const result = invariantPatchSchema.safeParse(extra);
      expect(result.success, JSON.stringify(extra)).toBe(false);
    }
    const result = invariantPatchSchema.safeParse({ name: 'ok', integration: { connect: { id: 'x' } } });
    expect(result.success).toBe(false);
    if (!result.success) expect(firstProblem(result.error)).toMatch(/Unknown field: integration/);
  });

  it('refuses wrong types and out-of-range numbers that used to become 500s', () => {
    for (const bad of [
      { name: 42 }, { name: '' }, { name: 'x'.repeat(201) }, { predicateExpression: { a: 1 } }, { evaluationWindowSec: 'soon' },
      { evaluationWindowSec: 1 }, { evaluationWindowSec: 10 ** 9 }, { minSamples: 0 }, { minSamples: 1.5 }, { expectedSuccessRate: 2 },
      { expectedSuccessRate: -0.1 }, { expectedSuccessRate: null }, { repairRequiredChecks: 'verify' }, { repairRequiredChecks: [1] },
      { repairRepository: 7 }, { repairFilePath: ['a'] },
    ]) {
      expect(invariantPatchSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('keeps null as a way to clear the repair target', () => {
    expect(invariantPatchSchema.parse({ repairRepository: null, repairFilePath: null })).toEqual({ repairRepository: null, repairFilePath: null });
  });

  it('requires a name, a predicate and an integration to create', () => {
    for (const missing of ['integrationId', 'name', 'predicateExpression']) {
      const body: Record<string, unknown> = { ...valid };
      delete body[missing];
      expect(invariantCreateSchema.safeParse(body).success, missing).toBe(false);
    }
  });

  it('bounds the window a manual evaluation can scan', () => {
    expect(invariantEvaluateSchema.safeParse({}).success).toBe(true);
    expect(invariantEvaluateSchema.safeParse({ windowStart: '2026-10-01T00:00:00Z', windowEnd: '2026-10-02T00:00:00Z' }).success).toBe(true);
    expect(invariantEvaluateSchema.safeParse({ windowStart: 'not a date' }).success).toBe(false);
    expect(invariantEvaluateSchema.safeParse({ windowStart: '2026-10-02T00:00:00Z', windowEnd: '2026-10-01T00:00:00Z' }).success).toBe(false);
    expect(invariantEvaluateSchema.safeParse({ windowStart: '2020-01-01T00:00:00Z', windowEnd: '2026-10-01T00:00:00Z' }).success).toBe(false);
  });
});

describe('drift configuration body', () => {
  it('accepts valid tuning', () => {
    expect(driftConfigSchema.parse({ enabled: false, minDetectionSamples: '25', significanceThreshold: 0.05 }))
      .toEqual({ enabled: false, minDetectionSamples: 25, significanceThreshold: 0.05 });
  });

  it('cannot name another integration or smuggle fields', () => {
    expect(driftConfigSchema.safeParse({ integrationId: 'someone-elses' }).success).toBe(false);
    expect(driftConfigSchema.safeParse({ enabled: false, id: 'x' }).success).toBe(false);
  });

  it('refuses a body that is not an object, and nonsense thresholds', () => {
    for (const bad of ['undefined', 42, [1, 2], null, { significanceThreshold: 0 }, { significanceThreshold: 1 }, { baselineWindowDays: 0 }, { detectionWindowHours: 1000 }, { enabled: 'yes' }]) {
      expect(driftConfigSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('NUL characters', () => {
  it('are found anywhere in a body, including keys, arrays and deep objects', () => {
    expect(containsNullByte({ a: 'ok' })).toBe(false);
    expect(containsNullByte({ a: 'x\u0000y' })).toBe(true);
    expect(containsNullByte({ 'k\u0000': 1 })).toBe(true);
    expect(containsNullByte([[{ deep: ['\u0000'] }]])).toBe(true);
    expect(containsNullByte(null)).toBe(false);
    expect(containsNullByte(undefined)).toBe(false);
  });

  it('are found in URLs however they are encoded', () => {
    for (const url of ['/api/v1/x/a%00b', '/api/v1/x?q=%00', '/api/v1/x/a%2500b', '/api/v1/x/a\u0000b']) expect(urlContainsNullByte(url), url).toBe(true);
    for (const url of ['/api/v1/x/abc', '/api/v1/x?a=%20b', '/api/v1/x/100%25']) expect(urlContainsNullByte(url), url).toBe(false);
  });

  it('stay cheap on huge input', () => {
    const wide = Object.fromEntries(Array.from({ length: 50_000 }, (_, i) => [`k${i}`, 'x']));
    const started = Date.now();
    containsNullByte(wide);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
