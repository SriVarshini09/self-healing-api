// AES-256-GCM encryption for customer secrets stored at rest (outcome-check
// database URLs, Stripe API keys, Slack webhook URLs). Ciphertexts are
// versioned so the key derivation can change later without breaking stored values.
//
// Key ring: new values are always encrypted with the current key
// (SHAPI_ENCRYPTION_KEY, or JWT_SECRET on deployments that have not set one).
// Decryption also accepts SHAPI_ENCRYPTION_KEY_PREVIOUS and, once a dedicated
// key is set, the old JWT_SECRET-derived key, so setting or rotating the key
// never strands stored secrets. `pnpm secrets:reencrypt --apply` moves every
// stored value to the current key.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

const VERSION = 'v1';

export type KeySource = { SHAPI_ENCRYPTION_KEY?: string; SHAPI_ENCRYPTION_KEY_PREVIOUS?: string; JWT_SECRET: string };

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(`shapi-secrets:${secret}`).digest();
}

/** Current key first, then keys still accepted for decryption. */
export function encryptionKeys(source: KeySource = config): Buffer[] {
  const secrets = [
    source.SHAPI_ENCRYPTION_KEY ?? source.JWT_SECRET,
    ...(source.SHAPI_ENCRYPTION_KEY_PREVIOUS ?? '').split(',').map(entry => entry.trim()).filter(Boolean),
    ...(source.SHAPI_ENCRYPTION_KEY ? [source.JWT_SECRET] : []),
  ];
  return [...new Set(secrets)].map(deriveKey);
}

export function encryptSecret(plaintext: string, keys: Buffer[] = encryptionKeys()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keys[0], iv, { authTagLength: 16 });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':');
}

/** Decrypts with whichever key in the ring authenticates; `keyIndex` 0 means the current key. */
export function decryptSecretWithKeyIndex(token: string, keys: Buffer[] = encryptionKeys()): { plaintext: string; keyIndex: number } {
  const [version, iv, tag, ciphertext] = token.split(':');
  if (version !== VERSION || !iv || !tag || !ciphertext) throw new Error('Unrecognized secret format');
  for (const [keyIndex, key] of keys.entries()) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'), { authTagLength: 16 });
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
      return { plaintext, keyIndex };
    } catch {
      // GCM authentication failed: wrong key, try the next one.
    }
  }
  throw new Error('Could not decrypt a stored secret with any configured key (was SHAPI_ENCRYPTION_KEY changed without SHAPI_ENCRYPTION_KEY_PREVIOUS?)');
}

export function decryptSecret(token: string, keys: Buffer[] = encryptionKeys()): string {
  return decryptSecretWithKeyIndex(token, keys).plaintext;
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
