// End-to-end: moving stored secrets to a dedicated SHAPI_ENCRYPTION_KEY, then
// rotating that key, against a real database and the real re-encrypt script.
// Checks: values written under the old JWT_SECRET-derived key stay readable
// once a dedicated key is set; the dry run changes nothing; --apply moves them;
// afterwards rotating JWT_SECRET no longer matters; a second rotation via
// SHAPI_ENCRYPTION_KEY_PREVIOUS works; secret values never appear in output.
// Run: pnpm --filter @shapi/backend e2e:key-rotation
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { prisma } = await import('../src/utils/prisma.js');
const { decryptSecretWithKeyIndex, encryptSecret, encryptionKeys } = await import('../src/utils/secrets.js');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ok - ${message}`);
}

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JWT = process.env.JWT_SECRET!;
const KEY_1 = `e2e-dedicated-key-one-${'1'.repeat(24)}`;
const KEY_2 = `e2e-dedicated-key-two-${'2'.repeat(24)}`;
const SLACK_URL = `https://hooks.slack.com/services/T0/B0/rotation${Date.now()}`;

/** Run the real script as an operator would, with its own environment. */
function reencrypt(env: Record<string, string>, apply: boolean): string {
  // Fixed command string: no user input reaches the shell.
  const output = execSync(`npx tsx scripts/reencrypt-secrets.ts${apply ? ' --apply' : ''}`, {
    cwd: backendDir,
    env: { ...process.env, SHAPI_ENCRYPTION_KEY: '', SHAPI_ENCRYPTION_KEY_PREVIOUS: '', ...env },
    encoding: 'utf8',
  });
  return output.split('\n').filter(line => line.startsWith('Secrets on the current key')).join('\n');
}

const tenant = await prisma.tenant.findFirst();
if (!tenant) throw new Error('seeded tenant missing');
let destinationId: string | undefined;

try {
  console.log('1. a secret stored before any dedicated key existed');
  const legacy = encryptionKeys({ JWT_SECRET: JWT });
  const destination = await prisma.alertDestination.create({
    data: { tenantId: tenant.id, kind: 'SLACK', name: 'rotation e2e', slackUrlCipher: encryptSecret(SLACK_URL, legacy) },
  });
  destinationId = destination.id;
  const stored = async () => (await prisma.alertDestination.findUniqueOrThrow({ where: { id: destination.id } })).slackUrlCipher!;
  const original = await stored();

  console.log('2. operator sets SHAPI_ENCRYPTION_KEY');
  const ring1 = encryptionKeys({ JWT_SECRET: JWT, SHAPI_ENCRYPTION_KEY: KEY_1 });
  assert(decryptSecretWithKeyIndex(original, ring1).plaintext === SLACK_URL, 'old value still decrypts with the dedicated key set');
  const dry = reencrypt({ SHAPI_ENCRYPTION_KEY: KEY_1 }, false);
  assert(/need re-encryption \(run with --apply\): [1-9]/.test(dry) && /unreadable: 0/.test(dry), `dry run reports work (${dry})`);
  assert(await stored() === original, 'dry run changed nothing');
  const applied = reencrypt({ SHAPI_ENCRYPTION_KEY: KEY_1 }, true);
  assert(/re-encrypted: [1-9]/.test(applied) && !applied.includes(SLACK_URL), 'apply re-encrypts; output never contains the secret');
  assert(decryptSecretWithKeyIndex(await stored(), ring1).keyIndex === 0, 'value is now on the dedicated key');
  assert(/re-encrypted: 0|need re-encryption \(run with --apply\): 0/.test(reencrypt({ SHAPI_ENCRYPTION_KEY: KEY_1 }, false)), 'second dry run has nothing left to do');

  console.log('3. rotating JWT_SECRET no longer strands it');
  const rotatedJwt = encryptionKeys({ JWT_SECRET: 'r'.repeat(40), SHAPI_ENCRYPTION_KEY: KEY_1 });
  assert(decryptSecretWithKeyIndex(await stored(), rotatedJwt).plaintext === SLACK_URL, 'decrypts after a JWT_SECRET change');

  console.log('4. rotating the dedicated key');
  reencrypt({ SHAPI_ENCRYPTION_KEY: KEY_2, SHAPI_ENCRYPTION_KEY_PREVIOUS: KEY_1 }, true);
  const ring2Only = encryptionKeys({ JWT_SECRET: 'r'.repeat(40), SHAPI_ENCRYPTION_KEY: KEY_2 });
  assert(decryptSecretWithKeyIndex(await stored(), ring2Only).plaintext === SLACK_URL, 'after rotation the new key alone decrypts it');
  console.log('\nE2E KEY ROTATION OK');
} finally {
  if (destinationId) await prisma.alertDestination.deleteMany({ where: { id: destinationId } });
  await prisma.$disconnect();
}
