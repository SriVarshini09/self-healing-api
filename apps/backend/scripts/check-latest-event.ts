import { prisma } from '../src/utils/prisma.js';

async function main() {
  const ev = await prisma.webhookEvent.findFirst({ orderBy: { receivedAt: 'desc' } });
  console.log(JSON.stringify({
    type: ev?.eventType,
    status: ev?.status,
    at: ev?.receivedAt,
    payloadKeys: ev?.payload ? Object.keys(ev.payload as object) : null,
  }));
}

main()
  .catch(e => {
    console.error('FAILED:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
