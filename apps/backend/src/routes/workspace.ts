import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TenantRole } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { authenticatedKey, tenantIdFor } from '../utils/auth-context.js';

const patchSchema = z.object({ name: z.string().trim().min(2).max(80) }).strict();

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
    if (caller.role !== TenantRole.OWNER && caller.role !== TenantRole.ADMIN) {
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
}
