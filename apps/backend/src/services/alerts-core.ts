import { createHmac } from 'node:crypto';

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

export function nextAlertAttempt(attempt: number, now = new Date()): Date {
  const delayMs = Math.min(5 * 60 * 1000, 1000 * 2 ** Math.max(0, attempt - 1));
  return new Date(now.getTime() + delayMs);
}
