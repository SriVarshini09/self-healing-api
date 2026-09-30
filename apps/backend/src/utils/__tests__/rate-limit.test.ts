import { describe, expect, it } from 'vitest';
import { rateLimitKey } from '../rate-limit.js';

describe('rateLimitKey', () => {
  it('isolates authenticated API keys without storing the raw secret', () => {
    const first = rateLimitKey({ headers: { 'x-api-key': 'shapi_first' }, ip: '127.0.0.1' });
    const second = rateLimitKey({ headers: { 'x-api-key': 'shapi_second' }, ip: '127.0.0.1' });

    expect(first).not.toBe(second);
    expect(first).toMatch(/^api-key:[a-f0-9]{64}$/);
    expect(first).not.toContain('shapi_first');
    expect(rateLimitKey({ headers: { 'x-api-key': 'shapi_first' }, ip: '10.0.0.2' })).toBe(first);
  });

  it('falls back to the client IP for unauthenticated requests', () => {
    expect(rateLimitKey({ headers: {}, ip: '10.0.0.2' })).toBe('ip:10.0.0.2');
    expect(rateLimitKey({ headers: { 'x-api-key': ['shapi_first'] }, ip: '10.0.0.2' })).toMatch(/^api-key:/);
  });
});
