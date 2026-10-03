import { prisma } from '../src/utils/prisma.js';

const incidents = await prisma.incident.findMany({
  orderBy: { detectedAt: 'asc' },
  include: { invariant: { select: { name: true } } },
});
for (const i of incidents) {
  console.log(`${i.detectedAt.toISOString()} | ${i.status} | ${i.title} | invariant=${i.invariant?.name ?? i.invariantId}`);
}
await prisma.$disconnect();
