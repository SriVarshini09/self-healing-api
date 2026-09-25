import Stripe from 'stripe';

// Placeholder secret shipped in .env.example / local .env — never valid for real verification.
const DEV_SECRETS = new Set(['', 'whsec_dev_stripe_secret_1234567890abcdef', 'whsec_your_stripe_webhook_secret']);

export interface StripeVerification {
  /** true when a real HMAC verification was performed */
  verified: boolean;
  /** true when running in local test mode (signature 'test' or dev secret) */
  testMode: boolean;
  event: Stripe.Event;
}

/**
 * Verify a Stripe webhook using the real Stripe SDK.
 * Throws on invalid signature. Falls back to test mode when the request
 * carries the local-dev `test` signature or no real secret is configured,
 * so `simulate:*` scripts and E2E keep working without Stripe keys.
 */
export function verifyStripeWebhook(
  rawBody: string | Buffer,
  signature: string | undefined,
  webhookSecret: string | undefined,
): StripeVerification {
  const stripe = new Stripe('sk_test_shapi_placeholder');

  if (signature === 'test' || !webhookSecret || DEV_SECRETS.has(webhookSecret)) {
    const event = JSON.parse(
      typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'),
    ) as Stripe.Event;
    return { verified: false, testMode: true, event };
  }

  if (!signature) throw new Error('Missing stripe-signature header');

  const event = stripe.webhooks.constructEvent(
    typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody,
    signature,
    webhookSecret,
  );
  return { verified: true, testMode: false, event };
}
