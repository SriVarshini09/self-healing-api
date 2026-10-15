// Transactional email via Resend (https://resend.com). Configured with
// RESEND_API_KEY and ALERT_EMAIL_FROM; without them, email features stay off.
import { config } from '../config.js';

export function emailAvailable(): boolean {
  return Boolean(config.RESEND_API_KEY && config.ALERT_EMAIL_FROM);
}

export type EmailMessage = { to: string[]; subject: string; text: string; html: string };

/** Send one email now. Throws with a readable reason on failure. */
export async function sendEmail(message: EmailMessage): Promise<void> {
  if (!emailAvailable()) throw new Error('Email is not configured on this SHAPI instance');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.ALERT_WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.RESEND_API_KEY}` },
      body: JSON.stringify({ from: config.ALERT_EMAIL_FROM, ...message }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      throw new Error(`Email provider returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}
