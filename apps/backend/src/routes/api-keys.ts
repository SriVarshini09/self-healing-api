import type { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { Prisma, TenantRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticatedKey, tenantIdFor } from '../utils/auth-context.js';
import { canManageApiKeys, generateApiKey } from '../utils/api-keys.js';

const permissionSchema = z.enum(['read', 'write', '*']);
const keySchema = z.object({
  name: z.string().trim().min(1).max(200),
  permissions: z.array(permissionSchema).min(1).max(3).default(['read']),
  role: z.enum(['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER']).default('OPERATOR'),
  expiresAt: z.string().datetime({ offset: true }).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.expiresAt && new Date(value.expiresAt) <= new Date()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expiresAt'],
      message: 'expiresAt must be in the future',
    });
  }
});

function viewKey(key: {
  id: string;
  name: string;
  prefix: string;
  permissions: string[];
  role: TenantRole;
  expiresAt: Date | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}) {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    permissions: key.permissions,
    role: key.role,
    expiresAt: key.expiresAt,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
  };
}

export async function apiKeyRoutes(app: FastifyInstance) {
  app.get('/api-keys', async (request, reply) => {
    if (!canManageApiKeys(authenticatedKey(request))) {
      return reply.code(403).send({ error: 'API-key administration requires Owner or Admin role' });
    }
    const tenantId = tenantIdFor(request);
    const keys = await prisma.aPIKey.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        permissions: true,
        role: true,
        expiresAt: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });
    return reply.send(keys.map(viewKey));
  });

  app.post('/api-keys', async (request, reply) => {
    const caller = authenticatedKey(request);
    if (!canManageApiKeys(caller)) {
      return reply.code(403).send({ error: 'API-key administration requires Owner or Admin role' });
    }
    const tenantId = tenantIdFor(request);
    const parsed = keySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid API-key payload', details: parsed.error.flatten() });
    }
    const requestedRole = parsed.data.role as TenantRole;
    if (caller.role !== TenantRole.OWNER && (requestedRole === TenantRole.OWNER || requestedRole === TenantRole.ADMIN)) {
      return reply.code(403).send({ error: 'Only the Owner can assign Owner or Admin roles' });
    }

    const generated = generateApiKey();
    const created = await prisma.aPIKey.create({
      data: {
        tenantId,
        name: parsed.data.name,
        keyHash: generated.keyHash,
        prefix: generated.prefix,
        permissions: [...new Set(parsed.data.permissions)],
        role: requestedRole,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      },
    });
    return reply.code(201).send({
      key: generated.key,
      warning: 'Copy this key now. SHAPI never stores or returns the raw key again.',
      apiKey: viewKey(created),
    });
  });

  app.delete('/api-keys/:id', async (request, reply) => {
    if (!canManageApiKeys(authenticatedKey(request))) {
      return reply.code(403).send({ error: 'API-key administration requires Owner or Admin role' });
    }
    const tenantId = tenantIdFor(request);
    const { id } = (request.params ?? {}) as { id: string };
    if (id === authenticatedKey(request).id) {
      return reply.code(400).send({ error: 'The active API key cannot revoke itself' });
    }
    const existing = await prisma.aPIKey.findFirst({ where: { id, tenantId } });
    if (!existing) return reply.code(404).send({ error: 'API key not found' });
    await prisma.aPIKey.delete({ where: { id } });
    return reply.code(204).send();
  });
}

const bootstrapSchema = z.object({
  tenantName: z.string().trim().min(1).max(200),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  keyName: z.string().trim().min(1).max(200).default('Initial admin key'),
  permissions: z.array(permissionSchema).min(1).max(3).default(['*']),
  expiresAt: z.string().datetime({ offset: true }).optional(),
}).strict();

function sameSecret(actual: string | undefined, expected: string | undefined): boolean {
  if (!actual || !expected) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function bootstrapRoutes(app: FastifyInstance) {
  app.post('/bootstrap/tenant', async (request, reply) => {
    if (!process.env.SHAPI_BOOTSTRAP_TOKEN) return reply.code(404).send({ error: 'Not found' });
    if (!sameSecret(
      request.headers['x-bootstrap-token'] as string | undefined,
      process.env.SHAPI_BOOTSTRAP_TOKEN,
    )) {
      return reply.code(401).send({ error: 'Invalid bootstrap token' });
    }

    const parsed = bootstrapSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid tenant bootstrap payload', details: parsed.error.flatten() });
    }
    if (parsed.data.expiresAt && new Date(parsed.data.expiresAt) <= new Date()) {
      return reply.code(400).send({ error: 'expiresAt must be in the future' });
    }

    const generated = generateApiKey();
    try {
      const result = await prisma.$transaction(async tx => {
        const tenant = await tx.tenant.create({
          data: { name: parsed.data.tenantName, slug: parsed.data.slug },
        });
        const apiKey = await tx.aPIKey.create({
          data: {
            tenantId: tenant.id,
            name: parsed.data.keyName,
            keyHash: generated.keyHash,
            prefix: generated.prefix,
            permissions: [...new Set(parsed.data.permissions)],
            role: TenantRole.OWNER,
            expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
          },
        });
        return { tenant, apiKey };
      });
      return reply.code(201).send({
        tenant: { id: result.tenant.id, name: result.tenant.name, slug: result.tenant.slug },
        key: generated.key,
        apiKey: viewKey(result.apiKey),
        warning: 'Store this key now. SHAPI never stores or returns the raw key again.',
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.code(409).send({ error: 'Tenant slug or API key already exists' });
      }
      throw error;
    }
  });
}
