import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { publicApiOrigin } from '../public-url.js';

const request = (headers: Record<string, string>, protocol = 'http') => ({ headers, protocol }) as unknown as FastifyRequest;

afterEach(() => {
  delete process.env.BACKEND_URL;
  delete process.env.RENDER_EXTERNAL_URL;
});

describe('publicApiOrigin', () => {
  it('prefers BACKEND_URL, then the Render-assigned URL', () => {
    process.env.RENDER_EXTERNAL_URL = 'https://shapi-api.onrender.com';
    expect(publicApiOrigin(request({ host: 'internal:10000' }))).toBe('https://shapi-api.onrender.com');
    process.env.BACKEND_URL = 'https://api.shapi.dev/';
    expect(publicApiOrigin(request({ host: 'internal:10000' }))).toBe('https://api.shapi.dev');
  });

  it('falls back to the origin the request arrived on, behind a proxy too', () => {
    expect(publicApiOrigin(request({ host: '127.0.0.1:3101' }))).toBe('http://127.0.0.1:3101');
    expect(publicApiOrigin(request({ host: 'internal:10000', 'x-forwarded-proto': 'https,http', 'x-forwarded-host': 'shapi.example.com' }))).toBe('https://shapi.example.com');
  });

  it('never returns the old localhost:3001 default', () => {
    expect(publicApiOrigin(request({ host: 'shapi-api.onrender.com' }, 'https'))).not.toContain('localhost:3001');
  });
});
