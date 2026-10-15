// Operator tool: list "Request an invite" submissions, newest first.
//   pnpm --filter @shapi/backend invites:list          # last 50
//   pnpm --filter @shapi/backend invites:list --all
import { prisma } from '../src/utils/prisma.js';

try {
  const requests = await prisma.inviteRequest.findMany({
    orderBy: { updatedAt: 'desc' },
    ...(process.argv.includes('--all') ? {} : { take: 50 }),
  });
  if (!requests.length) console.log('No invite requests yet.');
  for (const request of requests) {
    console.log([
      request.updatedAt.toISOString().slice(0, 16).replace('T', ' '),
      request.email,
      request.name ?? '-',
      request.company ?? '-',
      request.requests > 1 ? `asked ${request.requests}x` : '',
    ].filter(Boolean).join(' | '));
    if (request.note) console.log(`    ${request.note.replace(/\s+/g, ' ').slice(0, 300)}`);
  }
} finally {
  await prisma.$disconnect();
}
