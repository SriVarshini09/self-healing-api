import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

/**
 * Keep authenticated tenants in separate buckets without retaining raw API
 * keys in the rate-limit store or exposing them through diagnostics.
 */
export function rateLimitKey(request: Pick<FastifyRequest, 'headers' | 'ip'>): string {
  const header = request.headers['x-api-key'];
  const apiKey = Array.isArray(header) ? header[0] : header;
  if (apiKey) return `api-key:${createHash('sha256').update(apiKey).digest('hex')}`;
  return `ip:${request.ip}`;
}
