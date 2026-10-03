import { createHmac } from 'node:crypto';

export const DEFAULT_ALERT_PROCESSING_LEASE_MS = 5 * 60 * 1000;

export type IncidentAlertInput = {
  id: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  detectedAt: Date | string;
  integration: { id: string; name: string; type: string };
  invariant?: { id: string; name: string } | null;
};

export function buildIncidentAlertPayload(incident: IncidentAlertInput) {
  return {
    event: 'incident.detected',
    occurredAt: new Date().toISOString(),
    incident: {
      id: incident.id,
      title: incident.title,
      description: incident.description,
      severity: incident.severity,
      status: incident.status,
      detectedAt: new Date(incident.detectedAt).toISOString(),
      integration: incident.integration,
      invariant: incident.invariant ?? null,
    },
  };
}

export function signAlertBody(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export function buildAlertRequest(
  incident: IncidentAlertInput,
  secret: string,
): { body: string; headers: Record<string, string> } {
  const body = JSON.stringify(buildIncidentAlertPayload(incident));
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'user-agent': 'SHAPI-alert-delivery/1.0',
      'x-shapi-alert-event': 'incident.detected',
      'x-shapi-alert-signature': signAlertBody(body, secret),
    },
  };
}

export function nextAlertAttempt(attempt: number, now = new Date()): Date {
  const delayMs = Math.min(5 * 60 * 1000, 1000 * 2 ** Math.max(0, attempt - 1));
  return new Date(now.getTime() + delayMs);
}

export function alertProcessingCutoff(
  now = new Date(),
  leaseMs = DEFAULT_ALERT_PROCESSING_LEASE_MS,
): Date {
  return new Date(now.getTime() - leaseMs);
}
