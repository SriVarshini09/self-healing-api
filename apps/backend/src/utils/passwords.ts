// Password hashing for email/password accounts (scrypt, per-user salt).
// Stored format: scrypt$N$r$p$<salt b64>$<hash b64> so parameters can be raised later.
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

function scrypt(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password.normalize('NFKC'), salt, KEY_LENGTH, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  // Always do the work, even without a stored hash, so timing does not reveal
  // whether an account exists.
  const parts = (stored ?? '').split('$');
  const valid = parts.length === 6 && parts[0] === 'scrypt';
  const [n, r, p] = valid ? parts.slice(1, 4).map(Number) : [N, R, P];
  const salt = valid ? Buffer.from(parts[4], 'base64') : randomBytes(16);
  const expected = valid ? Buffer.from(parts[5], 'base64') : randomBytes(KEY_LENGTH);
  const actual = await scrypt(password, salt, n, r, p);
  return valid && actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const PASSWORD_ISSUER = 'shapi:password';
