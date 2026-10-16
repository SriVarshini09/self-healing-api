import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

/** Trust the nearest `hops` proxies (0 trusts none): the value Fastify's trustProxy needs. */
export function trustProxyHops(hops: number): false | ((address: string, hop: number) => boolean) {
  return hops > 0 ? (_address, hop) => hop < hops : false;
}

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
