// Re-encrypt every stored customer secret with the current SHAPI_ENCRYPTION_KEY.
// Run after setting SHAPI_ENCRYPTION_KEY for the first time, or after rotating it
// (old key in SHAPI_ENCRYPTION_KEY_PREVIOUS). Dry run by default; prints counts
// only, never secret values.
//   pnpm --filter @shapi/backend secrets:reencrypt            # report
//   pnpm --filter @shapi/backend secrets:reencrypt --apply    # rewrite
import { prisma } from '../src/utils/prisma.js';
import { decryptSecretWithKeyIndex, encryptSecret } from '../src/utils/secrets.js';

const apply = process.argv.includes('--apply');
const totals = { current: 0, reencrypted: 0, unreadable: 0 };

/** Returns the new ciphertext when the value needs moving to the current key, or null. */
function migrate(label: string, cipher: string | null): string | null {
  if (!cipher) return null;
  try {
    const { plaintext, keyIndex } = decryptSecretWithKeyIndex(cipher);
    if (keyIndex === 0) {
      totals.current++;
      return null;
    }
    totals.reencrypted++;
    return encryptSecret(plaintext);
  } catch {
    totals.unreadable++;
    console.error(`  cannot decrypt ${label} with any configured key; left unchanged`);
    return null;
  }
}

try {
  const checks = await prisma.outcomeCheck.findMany({ select: { id: true, databaseUrlCipher: true, stripeApiKeyCipher: true } });
  for (const check of checks) {
    const databaseUrlCipher = migrate(`outcome check ${check.id} database URL`, check.databaseUrlCipher);
    const stripeApiKeyCipher = migrate(`outcome check ${check.id} Stripe key`, check.stripeApiKeyCipher);
    if (apply && (databaseUrlCipher || stripeApiKeyCipher)) {
      await prisma.outcomeCheck.update({
        where: { id: check.id },
        data: { ...(databaseUrlCipher ? { databaseUrlCipher } : {}), ...(stripeApiKeyCipher ? { stripeApiKeyCipher } : {}) },
      });
    }
  }
  const destinations = await prisma.alertDestination.findMany({ select: { id: true, slackUrlCipher: true } });
  for (const destination of destinations) {
    const slackUrlCipher = migrate(`alert destination ${destination.id} Slack URL`, destination.slackUrlCipher);
    if (apply && slackUrlCipher) await prisma.alertDestination.update({ where: { id: destination.id }, data: { slackUrlCipher } });
  }
  const verb = apply ? 're-encrypted' : 'need re-encryption (run with --apply)';
  console.log(`Secrets on the current key: ${totals.current}; ${verb}: ${totals.reencrypted}; unreadable: ${totals.unreadable}`);
  if (totals.unreadable) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
