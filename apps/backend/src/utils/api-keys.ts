import crypto from 'crypto';
import { prisma } from './prisma.js';

/** Local-dev demo key. Dev only — real deployments must generate their own. */
export const DEMO_API_KEY = 'shapi_demo_local_d3v_k3y_9f2c';

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export interface AuthenticatedKey {
  id: string;
  name: string;
  permissions: string[];
}

/**
 * Public paths under /api/v1 that authenticate via third-party signatures
 * (Stripe/GitHub HMAC) instead of SHAPI API keys.
 */
const PUBLIC_PREFIXES = ['/api/v1/webhooks/', '/api/v1/github/webhook'];

export function isPublicPath(url: string): boolean {
  const path = url.split('?')[0];
  return PUBLIC_PREFIXES.some(p => path === p || path.startsWith(p));
}

export async function authenticateApiKey(key: string | undefined): Promise<AuthenticatedKey | null> {
  if (!key) return null;
  const record = await prisma.aPIKey.findUnique({ where: { keyHash: hashApiKey(key) } });
  if (!record) return null;
  if (record.expiresAt && record.expiresAt < new Date()) return null;
  return { id: record.id, name: record.name, permissions: record.permissions };
}

export function hasPermission(key: AuthenticatedKey, required: string): boolean {
  return key.permissions.includes('*') || key.permissions.includes(required);
}
