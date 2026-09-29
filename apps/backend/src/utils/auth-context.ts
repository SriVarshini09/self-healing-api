import type { FastifyRequest } from 'fastify';
import type { AuthenticatedKey } from './api-keys.js';

export type AuthenticatedRequest = FastifyRequest & {
  shapiAuth?: AuthenticatedKey;
};

export function authenticatedKey(request: FastifyRequest): AuthenticatedKey {
  const key = (request as AuthenticatedRequest).shapiAuth;
  if (!key) throw new Error('Authenticated API key is missing');
  return key;
}

export function tenantIdFor(request: FastifyRequest): string {
  return authenticatedKey(request).tenantId;
}
