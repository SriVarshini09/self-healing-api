import { describe, expect, it } from 'vitest';
import {
  buildEmailMessage,
  buildSlackMessage,
  DESTINATION_MAX_ATTEMPTS,
  destinationChannel,
  escapeSlackText,
  isEmail,
  isPermanentHttpFailure,
  isSlackWebhookUrl,
  nextDestinationAttempt,
  parseDestinationChannel,
  plainTitle,
} from './alerts-core.js';

const incident = {
  id: 'inc-1',
  title: 'Invariant violated: Outcome: Paid customers are provisioned',
  description: 'Behavioral invariant failed',
  severity: 'HIGH',
  status: 'DETECTED',
  detectedAt: '2026-10-14T00:00:00.000Z',
  integration: { id: 'int-1', name: 'Stripe', type: 'STRIPE' },
  invariant: { id: 'outcome-chk-1', name: 'Outcome: Paid customers are provisioned' },
};

describe('alert delivery patience', () => {
  it('spreads workspace-destination retries over about 25 minutes, capped at 10 minutes', () => {
    const now = new Date('2026-10-01T00:00:00.000Z');
    const waits = Array.from({ length: 7 }, (_, index) => nextDestinationAttempt(index + 1, now).getTime() - now.getTime());
    expect(waits).toEqual([15_000, 30_000, 60_000, 120_000, 240_000, 480_000, 600_000]);
    expect(waits.reduce((sum, wait) => sum + wait, 0)).toBeGreaterThan(20 * 60_000);
    expect(DESTINATION_MAX_ATTEMPTS).toBe(8);
  });

  it('treats only client errors other than 408/425/429 as permanent', () => {
    for (const status of [400, 401, 403, 404, 410]) expect(isPermanentHttpFailure(status)).toBe(true);
    for (const status of [408, 425, 429, 500, 502, 503]) expect(isPermanentHttpFailure(status)).toBe(false);
  });

  it('escapes Slack markup in values that come from event data', () => {
    expect(escapeSlackText('<!channel> & <https://evil.example|click>')).toBe('&lt;!channel&gt; &amp; &lt;https://evil.example|click&gt;');
    const incident = {
      id: 'i1', title: 'T', description: 'd', severity: 'HIGH', status: 'DETECTED', detectedAt: new Date(),
      integration: { id: 'x', name: 'Stripe <prod>', type: 'STRIPE' }, invariant: null,
    };
    const message = buildSlackMessage(incident, { event: 'detected', dashboardUrl: 'https://app.example.test', detail: 'Customer <!channel> paid' });
    const text = JSON.stringify(message);
    expect(text).not.toContain('<!channel>');
    expect(text).toContain('Customer &lt;!channel&gt; paid');
    expect(message.text).toContain('Stripe &lt;prod&gt;');
  });
});

describe('alert destinations', () => {
  it('accepts only real Slack incoming-webhook URLs', () => {
    expect(isSlackWebhookUrl('https://hooks.slack.com/services/T000/B000/XXXX')).toBe(true);
    for (const bad of [
      'http://hooks.slack.com/services/T000/B000/XXXX',
      'https://hooks.slack.com.evil.example/services/x',
      'https://evil.example/hooks.slack.com/services/x',
      'https://hooks.slack.com:8443/services/x',
      'https://hooks.slack.com/workflows/x',
      'https://127.0.0.1/services/x',
      'not a url',
    ]) expect(isSlackWebhookUrl(bad), bad).toBe(false);
  });

  it('validates email recipients', () => {
    expect(isEmail('founder@acme.dev')).toBe(true);
    expect(isEmail('founder@acme')).toBe(false);
    expect(isEmail('Founder <founder@acme.dev>')).toBe(false);
  });

  it('round-trips outbox channel names', () => {
    expect(parseDestinationChannel(destinationChannel('dest-1', 'resolved'))).toEqual({ destinationId: 'dest-1', event: 'resolved' });
    expect(parseDestinationChannel('webhook')).toBeNull();
  });

  it('names the customer in Slack and links to the incident', () => {
    const message = buildSlackMessage(incident, {
      event: 'detected',
      dashboardUrl: 'https://app.shapi.dev/',
      detail: 'Customer cus_123 had a invoice.payment_succeeded (evt_9) but the expected database row was not found.',
    });
    const json = JSON.stringify(message);
    expect(message.text).toBe('Incident: Paid customers are provisioned (Stripe)');
    expect(json).toContain('cus_123');
    expect(json).toContain('https://app.shapi.dev/#/incidents/inc-1');
    const resolved = buildSlackMessage(incident, { event: 'resolved', dashboardUrl: 'https://app.shapi.dev' });
    expect(resolved.text).toMatch(/^Resolved: /);
    expect(JSON.stringify(resolved)).toContain('This incident was resolved.');
  });

  it('escapes HTML in email alerts', () => {
    const email = buildEmailMessage({ ...incident, invariant: { id: 'x', name: '<script>alert(1)</script>' } }, {
      event: 'detected',
      dashboardUrl: 'https://app.shapi.dev',
    });
    expect(email.subject).toBe('[SHAPI] Incident: <script>alert(1)</script>');
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.text).toContain('Open in SHAPI: https://app.shapi.dev/#/incidents/inc-1');
  });

  it('turns incident titles into plain words', () => {
    expect(plainTitle(incident.title)).toBe('Paid customers are provisioned');
    expect(plainTitle('No Failed Provisioning Invariant')).toBe('No Failed Provisioning');
  });
});
