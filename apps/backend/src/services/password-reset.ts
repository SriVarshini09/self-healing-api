// "Forgot password" for email/password accounts. A reset link carries a random
// token; only its SHA-256 hash is stored. Links expire after an hour, work once,
// and a new request replaces any earlier link. A successful reset signs the
// account out everywhere.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { hashPassword, normalizeEmail, PASSWORD_ISSUER } from '../utils/passwords.js';
import { emailAvailable, sendEmail } from './email.js';

export const RESET_TTL_MS = 60 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

/** Password account for an email, if any. SSO accounts have no password to reset. */
export async function findPasswordUser(email: string) {
  return prisma.user.findUnique({ where: { issuer_subject: { issuer: PASSWORD_ISSUER, subject: normalizeEmail(email) } } });
}

/** A fresh one-time link for this user; earlier unused links stop working. */
export async function createResetLink(userId: string, now = new Date()): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId } }),
    prisma.passwordResetToken.create({ data: { userId, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + RESET_TTL_MS) } }),
  ]);
  return `${config.DASHBOARD_URL.replace(/\/$/, '')}/#/reset-password?token=${token}`;
}

export function resetEmail(link: string, name: string | null) {
  const greeting = name ? `Hi ${name},` : 'Hi,';
  const text = `${greeting}\n\nSomeone asked to reset the password for your SHAPI account. Use this link within an hour:\n\n${link}\n\nIf it wasn't you, ignore this email: your password stays the same.\n`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:20px;color:#111">`
    + `<p>${escapeHtml(greeting)}</p>`
    + `<p>Someone asked to reset the password for your SHAPI account. The link works once, within an hour.</p>`
    + `<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 14px;background:#111;color:#fff;border-radius:10px;text-decoration:none">Choose a new password</a></p>`
    + `<p style="color:#4d4d4d">If it wasn't you, ignore this email: your password stays the same.</p>`
    + `</div>`;
  return { subject: 'Reset your SHAPI password', text, html };
}

/**
 * Email a reset link if a password account exists. Never reveals whether it
 * does, and never throws: the caller answers the same way either way.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  try {
    if (!emailAvailable()) return;
    const user = await findPasswordUser(email);
    if (!user) return;
    const link = await createResetLink(user.id);
    await sendEmail({ to: [user.email], ...resetEmail(link, user.name) });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Password reset email failed');
  }
}

/** Set a new password with a valid link. Returns the user, or null if the link is invalid or expired. */
export async function resetPassword(token: string, newPassword: string, now = new Date()) {
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!record) return null;
  if (record.expiresAt <= now) {
    await prisma.passwordResetToken.deleteMany({ where: { id: record.id } });
    return null;
  }
  const passwordHash = await hashPassword(newPassword);
  // Deleting the token first makes the link single-use even under concurrent requests.
  const claimed = await prisma.passwordResetToken.deleteMany({ where: { id: record.id } });
  if (claimed.count !== 1) return null;
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.deleteMany({ where: { userId: record.userId } }),
    prisma.authSession.deleteMany({ where: { userId: record.userId } }),
  ]);
  return record.user;
}
