import Stripe from 'stripe';

// Placeholder secrets shipped in .env.example, local .env and the demo seed.
// They are never valid for real verification, and in production they are refused outright.
export const PLACEHOLDER_WEBHOOK_SECRETS: ReadonlySet<string> = new Set([
  '',
  'whsec_dev_stripe_secret_1234567890abcdef',
  'whsec_your_stripe_webhook_secret',
  'whsec_demo_secret_1234567890abcdef',
]);

export function isPlaceholderWebhookSecret(secret: string | null | undefined): boolean {
  return !secret || PLACEHOLDER_WEBHOOK_SECRETS.has(secret);
}

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

  if (signature === 'test' || !webhookSecret || isPlaceholderWebhookSecret(webhookSecret)) {
    // Unverified events exist only so local scripts work without Stripe keys.
    // In production this would let anyone, or any integration saved with a
    // placeholder secret, bypass signature checking.
    if (process.env.NODE_ENV === 'production') throw new Error('Unsigned Stripe webhooks are not accepted in production');
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
