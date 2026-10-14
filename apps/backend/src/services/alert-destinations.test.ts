import { describe, expect, it } from 'vitest';
import {
  buildEmailMessage,
  buildSlackMessage,
  destinationChannel,
  isEmail,
  isSlackWebhookUrl,
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
