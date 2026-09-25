import { describe, it, expect } from 'vitest';
import { hashApiKey, isPublicPath, hasPermission } from '../api-keys.js';

describe('api-keys', () => {
  it('hashes deterministically and differs per key', () => {
    expect(hashApiKey('shapi_a')).toBe(hashApiKey('shapi_a'));
    expect(hashApiKey('shapi_a')).not.toBe(hashApiKey('shapi_b'));
    expect(hashApiKey('shapi_a')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('exempts third-party webhook receivers, protects everything else', () => {
    expect(isPublicPath('/api/v1/webhooks/stripe')).toBe(true);
    expect(isPublicPath('/api/v1/webhooks/abc-123')).toBe(true);
    expect(isPublicPath('/api/v1/github/webhook')).toBe(true);
    expect(isPublicPath('/api/v1/sdk/track')).toBe(false);
    expect(isPublicPath('/api/v1/invariants')).toBe(false);
    expect(isPublicPath('/api/v1/incidents?pageSize=5')).toBe(false);
    expect(isPublicPath('/api/v1/drift/summary')).toBe(false);
  });

  it('checks permissions with wildcard support', () => {
    expect(hasPermission({ id: '1', name: 'x', permissions: ['*'] }, 'anything')).toBe(true);
    expect(hasPermission({ id: '1', name: 'x', permissions: ['a'] }, 'a')).toBe(true);
    expect(hasPermission({ id: '1', name: 'x', permissions: ['a'] }, 'b')).toBe(false);
  });
});
