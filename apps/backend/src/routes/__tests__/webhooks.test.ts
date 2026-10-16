import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { evaluatePredicate, verifyWebhookSignature } from '../webhooks.js';

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

  it('rejects unsigned provider webhooks and requires custom secrets', async () => {
    const integration = { id: 'int-test', webhookSecret: 'secret' };
    await expect(
      verifyWebhookSignature('sendgrid', integration, {}, {}, '{}'),
    ).resolves.toBe(false);
    await expect(
      verifyWebhookSignature('sendgrid', integration, { 'x-webhook-secret': 'wrong' }, {}, '{}'),
    ).resolves.toBe(false);
    await expect(
      verifyWebhookSignature('sendgrid', integration, { 'x-webhook-secret': 'secret' }, {}, '{}'),
    ).resolves.toBe(false);
    await expect(
      verifyWebhookSignature('custom', integration, { 'x-webhook-secret': 'secret' }, {}, '{}'),
    ).resolves.toBe(true);
  });

  it('verifies Twilio signatures using the full webhook URL and sorted parameters', async () => {
    const secret = 'twilio-auth-token';
    const url = 'https://example.test/api/v1/webhooks/twilio';
    const payload = { CallSid: 'CA123', From: '+15551212' };
    const material = `${url}CallSidCA123From+15551212`;
    const signature = crypto.createHmac('sha1', secret).update(material).digest('base64');
    await expect(
      verifyWebhookSignature(
        'twilio',
        { id: 'int-test', webhookSecret: secret },
        { 'x-twilio-signature': signature },
        payload,
        JSON.stringify(payload),
        url,
      ),
    ).resolves.toBe(true);
  });

  it('verifies SendGrid signatures with the provider public key and raw body', async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const raw = '[{"event":"delivered","sg_event_id":"evt-1"}]';
    const timestamp = '1700000000';
    const signature = crypto.sign(
      'sha256',
      Buffer.from(`${timestamp}${raw}`, 'utf8'),
      privateKey,
    ).toString('base64');
    const integration = {
      id: 'int-sendgrid',
      webhookSecret: null,
      config: { sendgridPublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString() },
    };

    await expect(
      verifyWebhookSignature(
        'sendgrid',
        integration,
        {
          'x-twilio-email-event-webhook-signature': signature,
          'x-twilio-email-event-webhook-timestamp': timestamp,
        },
        JSON.parse(raw) as Record<string, unknown>,
        raw,
      ),
    ).resolves.toBe(true);
  });
});
