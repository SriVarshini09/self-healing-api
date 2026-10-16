import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { TenantRole } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { authenticatedKey, tenantIdFor } from '../utils/auth-context.js';
import { emailAvailable, sendEmail } from '../services/email.js';
import { createInvite, INVITABLE_ROLES, inviteEmail, TeamError } from '../services/team.js';
import { deleteWorkspace } from '../services/retention.js';
import { destroySession, getCookie, SESSION_COOKIE } from '../utils/auth-sessions.js';

const patchSchema = z.object({ name: z.string().trim().min(2).max(80) }).strict();
const inviteSchema = z.object({
  email: z.string().trim().email().max(200),
  role: z.enum(INVITABLE_ROLES).default(TenantRole.OPERATOR),
}).strict();
const roleSchema = z.object({ role: z.enum(INVITABLE_ROLES) }).strict();
const deleteSchema = z.object({ confirm: z.string() }).strict();

function canManage(role: TenantRole): boolean {
  return role === TenantRole.OWNER || role === TenantRole.ADMIN;
}

function sendTeamError(reply: FastifyReply, error: unknown) {
  if (error instanceof TeamError) return reply.code(error.status).send({ error: error.message });
  throw error;
}

export async function workspaceRoutes(app: FastifyInstance) {
  app.get('/workspace', async (request, reply) => {
    const caller = authenticatedKey(request);
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantIdFor(request) },
      select: { id: true, name: true, slug: true, createdAt: true },
    });
    if (!tenant) return reply.code(404).send({ error: 'Workspace not found' });
    return reply.send({ ...tenant, caller: { name: caller.name, role: caller.role } });
  });

  app.patch('/workspace', async (request, reply) => {
    const caller = authenticatedKey(request);
    if (!canManage(caller.role)) {
      return reply.code(403).send({ error: 'Only an Owner or Admin can rename the workspace' });
    }
    const parsed = patchSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Workspace name must be 2 to 80 characters' });
    const tenant = await prisma.tenant.update({
      where: { id: tenantIdFor(request) },
      data: { name: parsed.data.name },
      select: { id: true, name: true, slug: true, createdAt: true },
    });
    return reply.send(tenant);
  });

  // Permanent. Only a signed-in Owner (a person, never an API key), and only by
  // typing the workspace name back.
  app.delete('/workspace', async (request, reply) => {
    const caller = authenticatedKey(request);
    const tenantId = tenantIdFor(request);
    const owner = await prisma.user.findFirst({ where: { id: caller.id, tenantId, role: TenantRole.OWNER }, select: { id: true } });
    if (!owner) return reply.code(403).send({ error: 'Only the workspace Owner, signed in, can delete the workspace' });
    const parsed = deleteSchema.safeParse(request.body ?? {});
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
    if (!tenant) return reply.code(404).send({ error: 'Workspace not found' });
    if (!parsed.success || parsed.data.confirm.trim() !== tenant.name) {
      return reply.code(400).send({ error: 'Type the workspace name exactly to confirm' });
    }
    await deleteWorkspace(tenantId);
    logger.warn({ tenantId, userId: owner.id }, 'Workspace deleted by its owner');
    // The session row went with the workspace; clear the browser cookie too.
    await destroySession(getCookie(request.headers.cookie, SESSION_COOKIE), reply);
    return reply.code(204).send();
  });

  // Members and pending invites. Everyone in the workspace can see who else is in it.
  app.get('/workspace/members', async request => {
    const tenantId = tenantIdFor(request);
    const caller = authenticatedKey(request);
    const [members, invites] = await Promise.all([
      prisma.user.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, email: true, role: true, issuer: true, createdAt: true },
      }),
      prisma.workspaceInvite.findMany({
        where: { tenantId, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, email: true, role: true, expiresAt: true, createdAt: true, invitedBy: { select: { name: true } } },
      }),
    ]);
    return {
      members: members.map(({ issuer, ...member }) => ({ ...member, sso: issuer !== 'shapi:password', you: member.id === caller.id })),
      invites: invites.map(({ invitedBy, ...invite }) => ({ ...invite, invitedBy: invitedBy?.name ?? null })),
      canManage: canManage(caller.role),
      emailAvailable: emailAvailable(),
    };
  });

  app.post('/workspace/invites', async (request, reply) => {
    const caller = authenticatedKey(request);
    if (!canManage(caller.role)) return reply.code(403).send({ error: 'Only an Owner or Admin can invite people' });
    const parsed = inviteSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Enter a valid email and role' });
    const tenantId = tenantIdFor(request);
    try {
      // API keys have no user row; only people are recorded as the inviter.
      const inviter = await prisma.user.findFirst({ where: { id: caller.id, tenantId }, select: { id: true, name: true } });
      const { invite, link } = await createInvite(tenantId, parsed.data.email, parsed.data.role, inviter?.id ?? null);
      let emailed = false;
      if (emailAvailable()) {
        try {
          const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });
          await sendEmail({ to: [invite.email], ...inviteEmail(link, tenant.name, inviter?.name ?? null) });
          emailed = true;
        } catch (error) {
          logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Invite email failed');
        }
      }
      // The link is returned once so it can be shared directly; only its hash is stored.
      return reply.code(201).send({
        invite: { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt },
        link,
        emailed,
      });
    } catch (error) {
      return sendTeamError(reply, error);
    }
  });

  app.delete('/workspace/invites/:id', async (request, reply) => {
    const caller = authenticatedKey(request);
    if (!canManage(caller.role)) return reply.code(403).send({ error: 'Only an Owner or Admin can revoke invites' });
    const { id } = request.params as { id: string };
    const deleted = await prisma.workspaceInvite.deleteMany({ where: { id, tenantId: tenantIdFor(request) } });
    if (!deleted.count) return reply.code(404).send({ error: 'Invite not found' });
    return reply.code(204).send();
  });

  app.patch('/workspace/members/:id', async (request, reply) => {
    const caller = authenticatedKey(request);
    if (!canManage(caller.role)) return reply.code(403).send({ error: 'Only an Owner or Admin can change roles' });
    const { id } = request.params as { id: string };
    const parsed = roleSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Choose Admin, Operator or Viewer' });
    const member = await prisma.user.findFirst({ where: { id, tenantId: tenantIdFor(request) } });
    if (!member) return reply.code(404).send({ error: 'Member not found' });
    if (member.id === caller.id) return reply.code(400).send({ error: "You can't change your own role" });
    if (member.role === TenantRole.OWNER) return reply.code(400).send({ error: "The workspace Owner's role can't be changed" });
    const updated = await prisma.user.update({
      where: { id },
      data: { role: parsed.data.role },
      select: { id: true, name: true, email: true, role: true },
    });
    return reply.send(updated);
  });

  app.delete('/workspace/members/:id', async (request, reply) => {
    const caller = authenticatedKey(request);
    if (!canManage(caller.role)) return reply.code(403).send({ error: 'Only an Owner or Admin can remove people' });
    const { id } = request.params as { id: string };
    const member = await prisma.user.findFirst({ where: { id, tenantId: tenantIdFor(request) } });
    if (!member) return reply.code(404).send({ error: 'Member not found' });
    if (member.id === caller.id) return reply.code(400).send({ error: "You can't remove yourself" });
    if (member.role === TenantRole.OWNER) return reply.code(400).send({ error: "The workspace Owner can't be removed" });
    // Deleting the user signs them out everywhere (sessions cascade).
    await prisma.user.delete({ where: { id } });
    return reply.code(204).send();
  });
}
