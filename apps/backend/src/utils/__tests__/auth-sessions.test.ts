import crypto from 'crypto';
import type { FastifyReply } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TenantRole } from '@prisma/client';

const fake = vi.hoisted(() => ({
  create: vi.fn(),
  deleteMany: vi.fn(),
  delete: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: { authSession: fake },
}));

vi.mock('../../config.js', () => ({
  config: { NODE_ENV: 'development' },
}));

import {
  authenticateSession,
  createSession,
  destroySession,
  getCookie,
  SESSION_COOKIE,
} from '../auth-sessions.js';

function reply() {
  return { header: vi.fn().mockReturnThis() } as unknown as FastifyReply & { header: ReturnType<typeof vi.fn> };
}

function sessionHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

describe('auth sessions', () => {
  beforeEach(() => {
    fake.create.mockReset();
    fake.deleteMany.mockReset();
    fake.delete.mockReset();
    fake.findUnique.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts cookies without confusing similarly named cookies', () => {
    expect(getCookie('other=value; shapi_session=abc; shapi_session_extra=no', SESSION_COOKIE)).toBe('abc');
    expect(getCookie('shapi_session=token=with=equals', SESSION_COOKIE)).toBe('token=with=equals');
    expect(getCookie(undefined, SESSION_COOKIE)).toBeUndefined();
  });

  it('creates a random hashed session and sends an HttpOnly cookie', async () => {
    const response = reply();
    fake.create.mockResolvedValue({ id: 'session-1' });
    const before = Date.now();

    await createSession('user-1', response);

    const data = fake.create.mock.calls[0][0].data as { userId: string; sessionHash: string; expiresAt: Date };
    expect(data.userId).toBe('user-1');
    expect(data.sessionHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(data.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 7 * 24 * 60 * 60 * 1000 - 1000);
    expect(data.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 7 * 24 * 60 * 60 * 1000 + 1000);
    expect(response.header).toHaveBeenCalledWith('set-cookie', expect.stringMatching(/^shapi_session=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=604800; HttpOnly; SameSite=Lax$/u));
  });

  it('returns the session cookie when the caller needs to combine it with another cookie', async () => {
    const response = reply();
    fake.create.mockResolvedValue({ id: 'session-1' });

    const cookie = await createSession('user-1');

    expect(cookie).toMatch(/^shapi_session=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=604800; HttpOnly; SameSite=Lax$/u);
    expect(response.header).not.toHaveBeenCalled();
  });

  it('maps active sessions to the user permissions implied by role', async () => {
    const token = 'viewer-session-token';
    fake.findUnique.mockResolvedValue({
      id: 'session-1',
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 'user-1', name: null, email: 'viewer@example.com', tenantId: 'tenant-1', role: TenantRole.VIEWER },
    });

    await expect(authenticateSession(token)).resolves.toEqual({
      id: 'user-1',
      name: 'viewer@example.com',
      tenantId: 'tenant-1',
      role: TenantRole.VIEWER,
      permissions: ['read'],
    });
    expect(fake.findUnique).toHaveBeenCalledWith({
      where: { sessionHash: sessionHash(token) },
      include: { user: true },
    });
  });

  it('rejects expired sessions and removes them from storage', async () => {
    fake.findUnique.mockResolvedValue({ id: 'expired-session', expiresAt: new Date(Date.now() - 1), user: {} });

    await expect(authenticateSession('expired-token')).resolves.toBeNull();
    expect(fake.delete).toHaveBeenCalledWith({ where: { id: 'expired-session' } });
  });

  it('deletes the session and clears the cookie on logout', async () => {
    const response = reply();
    fake.deleteMany.mockResolvedValue({ count: 1 });

    await destroySession('logout-token', response);

    expect(fake.deleteMany).toHaveBeenCalledWith({ where: { sessionHash: sessionHash('logout-token') } });
    expect(response.header).toHaveBeenCalledWith('set-cookie', 'shapi_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
  });
});
