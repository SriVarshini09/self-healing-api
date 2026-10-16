import { afterEach, describe, it, expect } from 'vitest';
import Stripe from 'stripe';
import crypto from 'crypto';
import { isPlaceholderWebhookSecret, verifyStripeWebhook } from '../stripe.js';

const payload = JSON.stringify({
  id: 'evt_test',
  type: 'invoice.payment_succeeded',
  data: { object: { id: 'in_test', amount_paid: 2000, status: 'paid' } },
});

function sign(payload: string, secret: string): string {
  const t = Math.floor(Date.now() / 1000);
  const signed = `${t}.${payload}`;
  const sig = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  return `t=${t},v1=${sig}`;
}

describe('stripe webhook verification', () => {
  it('verifies a real HMAC signature via the Stripe SDK', () => {
    const secret = 'whsec_real_test_secret_123';
    const sig = sign(payload, secret);
    const r = verifyStripeWebhook(payload, sig, secret);
    expect(r.verified).toBe(true);
    expect(r.testMode).toBe(false);
    expect(r.event.type).toBe('invoice.payment_succeeded');
  });

  it('rejects a forged signature with a real secret configured', () => {
    expect(() => verifyStripeWebhook(payload, 't=123,v1=deadbeef', 'whsec_real_test_secret_123')).toThrow();
  });

  it('falls back to test mode for local simulate scripts', () => {
    const r = verifyStripeWebhook(payload, 'test', 'whsec_dev_stripe_secret_1234567890abcdef');
    expect(r.testMode).toBe(true);
    expect(r.event.type).toBe('invoice.payment_succeeded');
  });

  it('matches the Stripe SDK generateTestHeaderString helper', () => {
    const stripe = new Stripe('sk_test_x');
    const secret = 'whsec_helper_secret';
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
    const r = verifyStripeWebhook(payload, header, secret);
    expect(r.verified).toBe(true);
  });

  describe('in production', () => {
    const realEnv = process.env.NODE_ENV;
    afterEach(() => { process.env.NODE_ENV = realEnv; });

    it('never skips signature checks, whatever the secret or header', () => {
      process.env.NODE_ENV = 'production';
      expect(() => verifyStripeWebhook(payload, 'test', 'whsec_real_test_secret_123')).toThrow();
      expect(() => verifyStripeWebhook(payload, 'whatever', 'whsec_your_stripe_webhook_secret')).toThrow(/production/);
      expect(() => verifyStripeWebhook(payload, 'whatever', 'whsec_demo_secret_1234567890abcdef')).toThrow(/production/);
      expect(() => verifyStripeWebhook(payload, 'whatever', undefined)).toThrow(/production/);
    });

    it('still verifies real signatures', () => {
      process.env.NODE_ENV = 'production';
      const secret = 'whsec_real_test_secret_123';
      expect(verifyStripeWebhook(payload, sign(payload, secret), secret).verified).toBe(true);
    });
  });

  it('knows which secrets are placeholders', () => {
    for (const secret of ['', undefined, null, 'whsec_dev_stripe_secret_1234567890abcdef', 'whsec_your_stripe_webhook_secret', 'whsec_demo_secret_1234567890abcdef']) {
      expect(isPlaceholderWebhookSecret(secret)).toBe(true);
    }
    expect(isPlaceholderWebhookSecret('whsec_real_test_secret_123')).toBe(false);
  });
});
