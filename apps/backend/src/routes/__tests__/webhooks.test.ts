import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { evaluatePredicate, performProportionTest, normalCDF, verifyWebhookSignature } from '../webhooks.js';

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

  it('github HMAC verifies against raw bytes, not re-stringified JSON', async () => {
    const secret = 'ghwebhook_test_secret';
    const integration = { id: 'int-test', webhookSecret: secret };
    // Raw bytes as GitHub sends them (whitespace included).
    const raw = '{"action":"opened","pull_request":{"number":42}}';
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const signature =
      'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');

    // Exact raw bytes verify.
    await expect(
      verifyWebhookSignature('github', integration, { 'x-hub-signature-256': signature }, payload, raw),
    ).resolves.toBe(true);

    // Pretty-printed JSON of the same payload must NOT verify (different bytes).
    const pretty = JSON.stringify(payload, null, 2);
    const prettySig =
      'sha256=' + crypto.createHmac('sha256', secret).update(pretty).digest('hex');
    await expect(
      verifyWebhookSignature('github', integration, { 'x-hub-signature-256': prettySig }, payload, raw),
    ).resolves.toBe(false);

    // Missing signature is rejected.
    await expect(
      verifyWebhookSignature('github', integration, {}, payload, raw),
    ).resolves.toBe(false);
  });
});
