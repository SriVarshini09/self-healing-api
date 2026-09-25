import { describe, it, expect } from 'vitest';
import { evaluatePredicate, performProportionTest, normalCDF } from '../webhooks.js';

describe('webhook invariant evaluation', () => {
  it('a 200 OK payload can still violate the business invariant', () => {
    const expr = "event.type === 'invoice.payment_succeeded' && event.payload && event.payload.amount_paid > 0";
    expect(
      evaluatePredicate(expr, { event: { type: 'invoice.payment_succeeded', payload: { amount_paid: 2000 }, headers: {} } }),
    ).toBe(true);
    expect(
      evaluatePredicate(expr, { event: { type: 'invoice.payment_succeeded', payload: { amount_paid: 0 }, headers: {} } }),
    ).toBe(false);
  });

  it('proportion test detects drift', () => {
    const r = performProportionTest(70, 100, 0.99);
    expect(r.pValue).toBeLessThan(0.01);
    expect(Math.abs(r.effectSize)).toBeGreaterThan(0.5);
  });

  it('normalCDF sanity', () => {
    expect(normalCDF(0)).toBeCloseTo(0.5, 2);
    expect(normalCDF(3)).toBeGreaterThan(0.99);
  });
});
