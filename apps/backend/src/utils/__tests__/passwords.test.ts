import { describe, expect, it } from 'vitest';
import { hashPassword, normalizeEmail, verifyPassword } from '../passwords.js';

describe('password hashing', () => {
  it('round-trips and uses a fresh salt each time', async () => {
    const first = await hashPassword('correct horse battery staple');
    const second = await hashPassword('correct horse battery staple');
    expect(first).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain('correct horse');
    expect(await verifyPassword('correct horse battery staple', first)).toBe(true);
  });

  it('rejects a wrong password, a missing hash and a malformed hash', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('Correct horse battery staple', stored)).toBe(false);
    expect(await verifyPassword('anything', null)).toBe(false);
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
  });

  it('normalizes emails for lookup', () => {
    expect(normalizeEmail('  Founder@Example.COM ')).toBe('founder@example.com');
  });
});
