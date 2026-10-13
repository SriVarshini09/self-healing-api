// AES-256-GCM encryption for customer secrets stored at rest (outcome-check
// database URLs and Stripe API keys). Ciphertexts are versioned so the key
// derivation can change later without breaking stored values.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

const VERSION = 'v1';

function encryptionKey(): Buffer {
  return createHash('sha256')
    .update(`shapi-secrets:${config.SHAPI_ENCRYPTION_KEY ?? config.JWT_SECRET}`)
    .digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptSecret(token: string): string {
  const [version, iv, tag, ciphertext] = token.split(':');
  if (version !== VERSION || !iv || !tag || !ciphertext) throw new Error('Unrecognized secret format');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

/** host:port/database only - safe to show in the dashboard and logs. */
export function describeDatabaseUrl(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    return `${url.hostname}${url.port ? `:${url.port}` : ''}${url.pathname}`;
  } catch {
    return 'invalid database URL';
  }
}
