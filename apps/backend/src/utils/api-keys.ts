import crypto from 'crypto';
import type { TenantRole } from '@prisma/client';
import { prisma } from './prisma.js';

/** Local-dev demo key. Dev only — real deployments must generate their own. */
export const DEMO_API_KEY = 'shapi_demo_local_d3v_k3y_9f2c';

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function generateApiKey(): { key: string; keyHash: string; prefix: string } {
  const key = `shapi_${crypto.randomBytes(32).toString('base64url')}`;
  return { key, keyHash: hashApiKey(key), prefix: key.slice(0, 14) };
}

export interface AuthenticatedKey {
  id: string;
  name: string;
  tenantId: string;
  role: TenantRole;
  permissions: string[];
}

export type ApiPermission = 'read' | 'write';

export function requiredPermission(method: string): ApiPermission {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase()) ? 'read' : 'write';
}

/**
 * Public paths under /api/v1 that authenticate via third-party signatures
 * (Stripe/GitHub HMAC) instead of SHAPI API keys.
 */
const PUBLIC_PREFIXES = ['/api/v1/webhooks/', '/api/v1/github/webhook', '/api/v1/bootstrap/tenant', '/api/v1/auth/'];
// Read before signing up: what SHAPI stores and which IPs it connects from.
const PUBLIC_PATHS = ['/api/v1/trust', '/api/v1/invite-requests'];

export function isPublicPath(url: string): boolean {
  const path = url.split('?')[0];
  return PUBLIC_PATHS.includes(path) || PUBLIC_PREFIXES.some(p => path === p || path.startsWith(p));
}

export async function authenticateApiKey(key: string | undefined): Promise<AuthenticatedKey | null> {
  if (!key) return null;
  const record = await prisma.aPIKey.findUnique({ where: { keyHash: hashApiKey(key) } });
  if (!record) return null;
  if (record.expiresAt && record.expiresAt < new Date()) return null;
  if (!record.tenantId) return null;
  void prisma.aPIKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } });
  return { id: record.id, name: record.name, tenantId: record.tenantId, role: record.role, permissions: record.permissions };
}

export function hasPermission(key: AuthenticatedKey, required: string): boolean {
  return key.permissions.includes('*') || key.permissions.includes(required);
}

export function canManageApiKeys(key: AuthenticatedKey): boolean {
  return key.role === 'OWNER' || key.role === 'ADMIN';
}
