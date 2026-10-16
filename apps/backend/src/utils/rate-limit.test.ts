import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { rateLimitKey } from './rate-limit.js';

// Documents how request.ip (and so the rate-limit bucket) depends on SHAPI_TRUST_PROXY_HOPS.
async function keyFor(trustProxy: number | false, headers: Record<string, string>, remoteAddress: string) {
  const app = Fastify({ trustProxy });
  app.get('/key', async request => ({ key: rateLimitKey(request), ip: request.ip }));
  const response = await app.inject({ method: 'GET', url: '/key', headers, remoteAddress });
  await app.close();
  return response.json() as { key: string; ip: string };
}

describe('rate-limit bucket per visitor', () => {
  // Visitor -> Render edge -> dashboard nginx -> Render edge -> API: the API sees the connecting
  // edge plus "client, edge, nginx" in X-Forwarded-For.
  const dashboardPath = { 'x-forwarded-for': '203.0.113.7, 10.1.1.1, 10.2.2.2' };

  it('without trusting proxies every visitor shares the proxy\'s address (the bug it fixes)', async () => {
    const one = await keyFor(false, dashboardPath, '10.3.3.3');
    const other = await keyFor(false, { 'x-forwarded-for': '198.51.100.9, 10.1.1.1, 10.2.2.2' }, '10.3.3.3');
    expect(one.ip).toBe('10.3.3.3');
    expect(one.key).toBe(other.key);
  });

  it('with the right hop count each visitor gets their own bucket', async () => {
    const one = await keyFor(3, dashboardPath, '10.3.3.3');
    const other = await keyFor(3, { 'x-forwarded-for': '198.51.100.9, 10.1.1.1, 10.2.2.2' }, '10.3.3.3');
    expect(one.ip).toBe('203.0.113.7');
    expect(other.ip).toBe('198.51.100.9');
    expect(one.key).not.toBe(other.key);
  });

  it('API keys always get their own bucket, whatever the address', async () => {
    const a = await keyFor(false, { 'x-api-key': 'shapi_aaaaaaaaaaaaaaaa' }, '10.3.3.3');
    const b = await keyFor(false, { 'x-api-key': 'shapi_bbbbbbbbbbbbbbbb' }, '10.3.3.3');
    expect(a.key).toMatch(/^api-key:/);
    expect(a.key).not.toBe(b.key);
    expect(a.key).not.toContain('shapi_aaaa');
  });
});
