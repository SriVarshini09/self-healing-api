import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config.js', () => ({ config: { JWT_SECRET: 'j'.repeat(32) } }));

const { decryptSecret, decryptSecretWithKeyIndex, encryptSecret, encryptionKeys } = await import('../secrets.js');

const JWT = 'j'.repeat(32);
const KEY_A = 'a'.repeat(40);
const KEY_B = 'b'.repeat(40);
const URL = 'postgresql://ro:secret@db.example.com:5432/app';

describe('encryption key ring', () => {
  it('without a dedicated key, encrypts with the JWT_SECRET-derived key (existing deployments)', () => {
    const legacy = encryptionKeys({ JWT_SECRET: JWT });
    expect(legacy).toHaveLength(1);
    expect(decryptSecret(encryptSecret(URL, legacy), legacy)).toBe(URL);
  });

  it('setting SHAPI_ENCRYPTION_KEY keeps old values readable and encrypts new ones with the new key', () => {
    const before = encryptSecret(URL, encryptionKeys({ JWT_SECRET: JWT }));
    const ring = encryptionKeys({ JWT_SECRET: JWT, SHAPI_ENCRYPTION_KEY: KEY_A });
    expect(decryptSecretWithKeyIndex(before, ring)).toEqual({ plaintext: URL, keyIndex: 1 });
    const after = encryptSecret(URL, ring);
    expect(decryptSecretWithKeyIndex(after, ring)).toEqual({ plaintext: URL, keyIndex: 0 });
    // The new value no longer depends on JWT_SECRET: rotating it does not strand the secret.
    expect(decryptSecret(after, encryptionKeys({ JWT_SECRET: 'r'.repeat(32), SHAPI_ENCRYPTION_KEY: KEY_A }))).toBe(URL);
  });

  it('rotates through SHAPI_ENCRYPTION_KEY_PREVIOUS', () => {
    const old = encryptSecret(URL, encryptionKeys({ JWT_SECRET: JWT, SHAPI_ENCRYPTION_KEY: KEY_A }));
    const rotated = encryptionKeys({ JWT_SECRET: JWT, SHAPI_ENCRYPTION_KEY: KEY_B, SHAPI_ENCRYPTION_KEY_PREVIOUS: ` ${KEY_A} ,` });
    expect(decryptSecretWithKeyIndex(old, rotated)).toEqual({ plaintext: URL, keyIndex: 1 });
  });

  it('fails clearly when no configured key matches, and rejects tampering', () => {
    const value = encryptSecret(URL, encryptionKeys({ JWT_SECRET: JWT, SHAPI_ENCRYPTION_KEY: KEY_A }));
    expect(() => decryptSecret(value, encryptionKeys({ JWT_SECRET: 'z'.repeat(32), SHAPI_ENCRYPTION_KEY: KEY_B })))
      .toThrow(/any configured key/);
    const [version, iv, tag, body] = value.split(':');
    const tampered = [version, iv, tag, Buffer.from(Buffer.from(body, 'base64').map(byte => byte ^ 1)).toString('base64')].join(':');
    expect(() => decryptSecret(tampered, encryptionKeys({ JWT_SECRET: JWT, SHAPI_ENCRYPTION_KEY: KEY_A }))).toThrow();
    expect(() => decryptSecret('v0:x:y:z')).toThrow(/Unrecognized/);
  });

  it('never stores the plaintext and uses a fresh IV each time', () => {
    const first = encryptSecret(URL);
    expect(first).not.toContain('secret@');
    expect(encryptSecret(URL)).not.toBe(first);
    expect(decryptSecret(first)).toBe(URL);
  });
});
