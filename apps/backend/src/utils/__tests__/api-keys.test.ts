import { describe, it, expect } from 'vitest';
import { canManageApiKeys, generateApiKey, hashApiKey, isPublicPath, hasPermission, requiredPermission } from '../api-keys.js';
import { TenantRole } from '@prisma/client';

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
    expect(isPublicPath('/api/v1/bootstrap/tenant')).toBe(true);
    expect(isPublicPath('/api/v1/sdk/track')).toBe(false);
    expect(isPublicPath('/api/v1/invariants')).toBe(false);
    expect(isPublicPath('/api/v1/incidents?pageSize=5')).toBe(false);
    expect(isPublicPath('/api/v1/drift/summary')).toBe(false);
  });

  it('checks permissions with wildcard support', () => {
    expect(hasPermission({ id: '1', name: 'x', tenantId: 't', role: TenantRole.OWNER, permissions: ['*'] }, 'anything')).toBe(true);
    expect(hasPermission({ id: '1', name: 'x', tenantId: 't', role: TenantRole.OPERATOR, permissions: ['a'] }, 'a')).toBe(true);
    expect(hasPermission({ id: '1', name: 'x', tenantId: 't', role: TenantRole.VIEWER, permissions: ['a'] }, 'b')).toBe(false);
  });

  it('separates tenant role administration from endpoint permissions', () => {
    expect(canManageApiKeys({ id: '1', name: 'owner', tenantId: 't', role: TenantRole.OWNER, permissions: ['read'] })).toBe(true);
    expect(canManageApiKeys({ id: '2', name: 'admin', tenantId: 't', role: TenantRole.ADMIN, permissions: ['write'] })).toBe(true);
    expect(canManageApiKeys({ id: '3', name: 'operator', tenantId: 't', role: TenantRole.OPERATOR, permissions: ['*'] })).toBe(false);
    expect(canManageApiKeys({ id: '4', name: 'viewer', tenantId: 't', role: TenantRole.VIEWER, permissions: ['read'] })).toBe(false);
  });

  it('maps read methods and mutations to separate permissions', () => {
    expect(requiredPermission('GET')).toBe('read');
    expect(requiredPermission('HEAD')).toBe('read');
    expect(requiredPermission('POST')).toBe('write');
    expect(requiredPermission('DELETE')).toBe('write');
  });

  it('generates opaque, hashable API keys', () => {
    const generated = generateApiKey();
    expect(generated.key).toMatch(/^shapi_[A-Za-z0-9_-]{43}$/);
    expect(generated.prefix).toBe(generated.key.slice(0, 14));
    expect(generated.keyHash).toBe(hashApiKey(generated.key));
  });
});
