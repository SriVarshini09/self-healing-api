import crypto from 'crypto';
import type { FastifyReply } from 'fastify';
import { TenantRole } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from './prisma.js';
import type { AuthenticatedKey } from './api-keys.js';

export const SESSION_COOKIE = 'shapi_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashSession(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function oidcEnabled(): boolean {
  return Boolean(
    config.OIDC_ISSUER_URL && config.OIDC_CLIENT_ID && config.OIDC_CLIENT_SECRET
      && config.OIDC_REDIRECT_URI && config.OIDC_DEFAULT_TENANT_SLUG,
  );
}

export function getCookie(header: string | undefined, name: string): string | undefined {
  return header?.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

export function sessionCookieOptions(): string {
  const secure = config.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}

export async function createSession(userId: string, reply: FastifyReply): Promise<void> {
  const token = crypto.randomBytes(32).toString('base64url');
  await prisma.authSession.create({
    data: {
      userId,
      sessionHash: hashSession(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  const secure = config.NODE_ENV === 'production' ? '; Secure' : '';
  void reply.header('set-cookie', `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; HttpOnly; SameSite=Lax${secure}`);
}

export async function destroySession(token: string | undefined, reply: FastifyReply): Promise<void> {
  if (token) await prisma.authSession.deleteMany({ where: { sessionHash: hashSession(token) } });
  void reply.header('set-cookie', sessionCookieOptions());
}

export async function authenticateSession(token: string | undefined): Promise<AuthenticatedKey | null> {
  if (!token) return null;
  const session = await prisma.authSession.findUnique({
    where: { sessionHash: hashSession(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt <= new Date()) {
    await prisma.authSession.delete({ where: { id: session.id } });
    return null;
  }
  const permissions = session.user.role === TenantRole.VIEWER ? ['read'] : ['read', 'write'];
  return {
    id: session.user.id,
    name: session.user.name ?? session.user.email,
    tenantId: session.user.tenantId,
    role: session.user.role,
    permissions,
  };
}
