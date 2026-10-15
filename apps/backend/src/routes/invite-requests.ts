import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { normalizeEmail } from '../utils/passwords.js';
import { emailAvailable, sendEmail } from '../services/email.js';

const optional = (max: number) => z.string().trim().max(max).optional().transform(value => value || undefined);
const requestSchema = z.object({
  email: z.string().trim().email().max(200),
  name: optional(80),
  company: optional(120),
  note: optional(1000),
  // Honeypot: hidden from people, filled in by form-spam bots.
  website: z.string().max(200).optional(),
}).strict();

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

async function notifyOperator(request: { email: string; name?: string; company?: string; note?: string }, repeat: boolean): Promise<void> {
  if (!config.SHAPI_OPERATOR_EMAIL || !emailAvailable()) return;
  const lines = [
    `Email: ${request.email}`,
    `Name: ${request.name ?? '-'}`,
    `Company: ${request.company ?? '-'}`,
    `Note: ${request.note ?? '-'}`,
  ];
  try {
    await sendEmail({
      to: [config.SHAPI_OPERATOR_EMAIL],
      subject: `${repeat ? 'Repeat' : 'New'} SHAPI invite request: ${request.company ?? request.email}`.slice(0, 200),
      text: `${lines.join('\n')}\n\nReply with the invite code to let them in.\n`,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:20px">${lines.map(line => `<p style="margin:0 0 6px">${escapeHtml(line)}</p>`).join('')}<p>Reply with the invite code to let them in.</p></div>`,
    });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Invite request notification failed');
  }
}

export async function inviteRequestRoutes(app: FastifyInstance) {
  // Public. Same answer for new, repeat and bot submissions.
  app.post('/invite-requests', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (request, reply) => {
    const parsed = requestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const emailIssue = parsed.error.issues.some(issue => issue.path[0] === 'email');
      return reply.code(400).send({ error: emailIssue ? 'Enter a valid work email' : 'Please shorten your answers' });
    }
    const { website, ...body } = parsed.data;
    if (website) return reply.code(202).send({ ok: true });

    const email = normalizeEmail(body.email);
    // Atomic, so simultaneous requests for one email cannot collide; blank
    // answers on a repeat request keep the earlier ones.
    const saved = await prisma.inviteRequest.upsert({
      where: { email },
      create: { email, name: body.name, company: body.company, note: body.note },
      update: { name: body.name, company: body.company, note: body.note, requests: { increment: 1 } },
    });
    void notifyOperator({ ...body, email }, saved.requests > 1);
    return reply.code(202).send({ ok: true });
  });
}
