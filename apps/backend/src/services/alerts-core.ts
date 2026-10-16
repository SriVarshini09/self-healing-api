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

// Workspace destinations (Slack, email) are the product's main promise: telling a person
// that a customer paid and got nothing. A provider blip of a few seconds must not lose
// that message, so they get far more patience than the operator webhook: 8 attempts
// spread over about 25 minutes (15s, 30s, 1m, 2m, 4m, 8m, 10m).
export const DESTINATION_MAX_ATTEMPTS = 8;

export function nextDestinationAttempt(attempt: number, now = new Date()): Date {
  const delayMs = Math.min(10 * 60 * 1000, 15_000 * 2 ** Math.max(0, attempt - 1));
  return new Date(now.getTime() + delayMs);
}

/** Retrying a 4xx (bad or removed webhook, rejected request) can never succeed; 408 and 429 can. */
export function isPermanentHttpFailure(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 425 && status !== 429;
}

/**
 * Slack treats &, < and > as markup: <!channel> pings everyone and <https://x|label> makes a
 * link. Values in alerts come from event data, so they are escaped as Slack requires.
 */
export function escapeSlackText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function alertProcessingCutoff(
  now = new Date(),
  leaseMs = DEFAULT_ALERT_PROCESSING_LEASE_MS,
): Date {
  return new Date(now.getTime() - leaseMs);
}

// ---------------------------------------------------------------------------
// Workspace alert destinations (Slack, email)
// ---------------------------------------------------------------------------

export type AlertEvent = 'detected' | 'resolved';

export function destinationChannel(destinationId: string, event: AlertEvent): string {
  return `dest:${destinationId}:${event}`;
}

export function parseDestinationChannel(channel: string): { destinationId: string; event: AlertEvent } | null {
  const match = /^dest:([^:]+):(detected|resolved)$/.exec(channel);
  return match ? { destinationId: match[1], event: match[2] as AlertEvent } : null;
}

/**
 * Only real Slack incoming-webhook URLs are accepted, so a destination can't be
 * used to make SHAPI send requests to arbitrary hosts.
 */
export function isSlackWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'hooks.slack.com' && url.pathname.startsWith('/services/') && !url.port;
  } catch {
    return false;
  }
}

const EMAIL_PATTERN = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
export function isEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value) && value.length <= 200;
}

/** Plain-words incident title: "Invariant violated: Outcome: X" -> "X". */
export function plainTitle(title: string): string {
  return title.replace(/^Invariant violated:\s*/i, '').replace(/^Outcome:\s*/i, '').replace(/\s+Invariant$/i, '');
}

export type AlertContext = {
  event: AlertEvent;
  dashboardUrl: string;
  /** e.g. "Customer cus_123 paid (evt_456) but no matching row was found." */
  detail?: string | null;
};

function incidentLink(incident: IncidentAlertInput, ctx: AlertContext): string {
  return `${ctx.dashboardUrl.replace(/\/$/, '')}/#/incidents/${incident.id}`;
}

function headline(incident: IncidentAlertInput, ctx: AlertContext): string {
  const name = plainTitle(incident.invariant?.name ?? incident.title);
  return ctx.event === 'resolved' ? `Resolved: ${name}` : `Incident: ${name}`;
}

export function buildSlackMessage(incident: IncidentAlertInput, ctx: AlertContext) {
  const title = headline(incident, ctx);
  const link = incidentLink(incident, ctx);
  const lines = [
    ctx.event === 'resolved'
      ? 'This incident was resolved.'
      : escapeSlackText(ctx.detail ?? incident.description),
    `*Integration:* ${escapeSlackText(incident.integration.name)} · *Severity:* ${incident.severity.toLowerCase()}`,
  ];
  return {
    text: escapeSlackText(`${title} (${incident.integration.name})`),
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: title.slice(0, 150), emoji: false } },
      { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n').slice(0, 2900) } },
      {
        type: 'actions',
        elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open in SHAPI' }, url: link }],
      },
    ],
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function buildEmailMessage(incident: IncidentAlertInput, ctx: AlertContext) {
  const title = headline(incident, ctx);
  const link = incidentLink(incident, ctx);
  const body = ctx.event === 'resolved' ? 'This incident was resolved.' : (ctx.detail ?? incident.description);
  const meta = `Integration: ${incident.integration.name} · Severity: ${incident.severity.toLowerCase()}`;
  return {
    subject: `[SHAPI] ${title}`.slice(0, 200),
    text: `${title}\n\n${body}\n${meta}\n\nOpen in SHAPI: ${link}\n`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:20px;color:#111">`
      + `<p style="font-size:18px;margin:0 0 12px">${escapeHtml(title)}</p>`
      + `<p style="margin:0 0 8px">${escapeHtml(body)}</p>`
      + `<p style="margin:0 0 16px;color:#4d4d4d">${escapeHtml(meta)}</p>`
      + `<a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 14px;background:#111;color:#fff;border-radius:10px;text-decoration:none">Open in SHAPI</a>`
      + `</div>`,
  };
}
