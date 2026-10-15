// Operator tool: create a one-time password reset link for an email/password
// account, for instances without email (Resend) configured. Send the link to
// the person yourself, over a channel you trust. It expires in an hour.
//   pnpm --filter @shapi/backend auth:reset-link person@example.com
import { prisma } from '../src/utils/prisma.js';
import { createResetLink, findPasswordUser } from '../src/services/password-reset.js';

const email = process.argv[2];
try {
  if (!email) throw new Error('Usage: pnpm --filter @shapi/backend auth:reset-link <email>');
  const user = await findPasswordUser(email);
  if (!user) throw new Error(`No email/password account for ${email}`);
  console.log(`Reset link for ${user.email} (expires in 1 hour, works once):`);
  console.log(await createResetLink(user.id));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
