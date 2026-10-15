// Workspace teammates: invite links and accepting them. A link carries a random
// token; only its SHA-256 hash is stored. Links expire after 7 days, work once,
// and re-inviting the same email replaces the earlier link.
import crypto from 'node:crypto';
import { TenantRole, type WorkspaceInvite } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../utils/prisma.js';
import { hashPassword, normalizeEmail, PASSWORD_ISSUER } from '../utils/passwords.js';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Roles an invite can grant. There is one Owner: the person who created the workspace. */
export const INVITABLE_ROLES = [TenantRole.ADMIN, TenantRole.OPERATOR, TenantRole.VIEWER] as const;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export class TeamError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Create (or replace) an invite. Returns the one-time link; it is never stored. */
export async function createInvite(tenantId: string, email: string, role: TenantRole, invitedById: string | null, now = new Date()) {
  const normalized = normalizeEmail(email);
  const existing = await prisma.user.findUnique({ where: { issuer_subject: { issuer: PASSWORD_ISSUER, subject: normalized } } });
  if (existing?.tenantId === tenantId) throw new TeamError('That person is already in this workspace', 409);
  // Password accounts belong to one workspace.
  if (existing) throw new TeamError('That email already has a SHAPI account in another workspace', 409);

  const token = crypto.randomBytes(32).toString('base64url');
  const data = { role, tokenHash: hashToken(token), invitedById, expiresAt: new Date(now.getTime() + INVITE_TTL_MS) };
  const invite = await prisma.workspaceInvite.upsert({
    where: { tenantId_email: { tenantId, email: normalized } },
    create: { tenantId, email: normalized, ...data },
    update: { ...data, createdAt: now },
  });
  const link = `${config.DASHBOARD_URL.replace(/\/$/, '')}/#/accept-invite?token=${token}`;
  return { invite, link };
}

export function inviteEmail(link: string, workspaceName: string, inviterName: string | null) {
  const who = inviterName ? `${inviterName} invited you` : 'You were invited';
  const text = `${who} to the "${workspaceName}" workspace on SHAPI, which checks that every paying customer gets what they paid for.\n\nJoin within 7 days:\n\n${link}\n`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:20px;color:#111">`
    + `<p>${escapeHtml(who)} to the <strong>${escapeHtml(workspaceName)}</strong> workspace on SHAPI, which checks that every paying customer gets what they paid for.</p>`
    + `<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 14px;background:#111;color:#fff;border-radius:10px;text-decoration:none">Join the workspace</a></p>`
    + `<p style="color:#4d4d4d">The link works once, within 7 days.</p>`
    + `</div>`;
  return { subject: `Join ${workspaceName} on SHAPI`.slice(0, 200), text, html };
}

/** A valid, unexpired invite for this token, with its workspace; null otherwise. */
export async function findInvite(token: string, now = new Date()): Promise<(WorkspaceInvite & { tenant: { name: string }; invitedBy: { name: string | null } | null }) | null> {
  const invite = await prisma.workspaceInvite.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { tenant: { select: { name: true } }, invitedBy: { select: { name: true } } },
  });
  if (!invite) return null;
  if (invite.expiresAt <= now) {
    await prisma.workspaceInvite.deleteMany({ where: { id: invite.id } });
    return null;
  }
  return invite;
}

/** Create the invited person's account in the workspace. The invite is used up. */
export async function acceptInvite(token: string, name: string, password: string, now = new Date()) {
  const invite = await findInvite(token, now);
  if (!invite) throw new TeamError('This invite link is invalid or has expired. Ask for a new one.', 400);
  const taken = await prisma.user.findUnique({ where: { issuer_subject: { issuer: PASSWORD_ISSUER, subject: invite.email } } });
  if (taken) throw new TeamError('An account with this email already exists. Sign in instead.', 409);
  const passwordHash = await hashPassword(password);
  // Deleting first makes the link single-use even under concurrent requests.
  const claimed = await prisma.workspaceInvite.deleteMany({ where: { id: invite.id } });
  if (claimed.count !== 1) throw new TeamError('This invite link has already been used', 400);
  try {
    return await prisma.user.create({
      data: { tenantId: invite.tenantId, issuer: PASSWORD_ISSUER, subject: invite.email, email: invite.email, name, role: invite.role, passwordHash },
    });
  } catch (error) {
    // Unique (issuer, subject): the same email signed up at the same moment.
    if ((error as { code?: string }).code === 'P2002') throw new TeamError('An account with this email already exists. Sign in instead.', 409);
    throw error;
  }
}
