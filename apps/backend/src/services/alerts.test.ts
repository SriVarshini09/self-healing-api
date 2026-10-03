import { describe, expect, it } from 'vitest';
import {
  alertProcessingCutoff,
  buildAlertRequest,
  buildIncidentAlertPayload,
  nextAlertAttempt,
  signAlertBody,
} from './alerts-core.js';

describe('incident alert delivery helpers', () => {
  it('signs the exact JSON body with an HMAC header value', () => {
    const body = JSON.stringify({ event: 'incident.detected', id: 'incident-1' });
    expect(signAlertBody(body, 'secret')).toBe(
      'sha256=337e7b85412097d89c78cb5be642b09dd83248348edb37ba3c2ed9176e2ee60e',
    );
  });

  it('builds a provider-neutral incident payload without secrets', () => {
    const payload = buildIncidentAlertPayload({
      id: 'incident-1',
      title: 'Drift detected',
      description: 'Outcome changed',
      severity: 'HIGH',
      status: 'DETECTED',
      detectedAt: '2026-10-01T00:00:00.000Z',
      integration: { id: 'integration-1', name: 'Payments', type: 'STRIPE' },
      invariant: { id: 'invariant-1', name: 'Payment outcome' },
    });
    expect(payload.event).toBe('incident.detected');
    expect(payload.incident.integration.name).toBe('Payments');
    expect(JSON.stringify(payload)).not.toContain('secret');
  });

  it('builds a signed webhook request with stable delivery headers', () => {
    const request = buildAlertRequest(
      {
        id: 'incident-1',
        title: 'Drift detected',
        description: 'Outcome changed',
        severity: 'HIGH',
        status: 'DETECTED',
        detectedAt: '2026-10-01T00:00:00.000Z',
        integration: { id: 'integration-1', name: 'Payments', type: 'STRIPE' },
      },
      'secret',
    );

    expect(request.headers).toEqual({
      'content-type': 'application/json',
      'user-agent': 'SHAPI-alert-delivery/1.0',
      'x-shapi-alert-event': 'incident.detected',
      'x-shapi-alert-signature': signAlertBody(request.body, 'secret'),
    });
    expect(JSON.parse(request.body)).toMatchObject({
      event: 'incident.detected',
      incident: { id: 'incident-1', severity: 'HIGH' },
    });
  });

  it('backs off exponentially and caps the delay', () => {
    const now = new Date('2026-10-01T00:00:00.000Z');
    expect(nextAlertAttempt(1, now).toISOString()).toBe('2026-10-01T00:00:01.000Z');
    expect(nextAlertAttempt(3, now).toISOString()).toBe('2026-10-01T00:00:04.000Z');
    expect(nextAlertAttempt(20, now).toISOString()).toBe('2026-10-01T00:05:00.000Z');
  });

  it('uses a bounded lease cutoff for crashed in-progress deliveries', () => {
    const now = new Date('2026-10-01T00:05:00.000Z');
    expect(alertProcessingCutoff(now).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(alertProcessingCutoff(now, 30_000).toISOString()).toBe('2026-10-01T00:04:30.000Z');
  });
});
