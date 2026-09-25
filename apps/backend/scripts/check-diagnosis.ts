// Verifies diagnoseIncident cites tracked business-outcome failures.
// Self-cleaning: removes everything it creates. Exits 0/1.
import { prisma } from '../src/utils/prisma.js';
import { diagnoseIncident } from '../src/services/diagnosis.js';

async function main() {
  const integration = await prisma.integration.findFirst({ where: { type: 'STRIPE' } });
  if (!integration) throw new Error('no STRIPE integration (run db:seed)');
  const invariant = await prisma.invariant.findFirst({
    where: { integrationId: integration.id, id: 'inv-stripe-provisioning' },
  });
  if (!invariant) throw new Error('provisioning invariant missing (reseed)');

  const tracked = await prisma.trackedEvent.create({
    data: {
      eventId: `check-${Date.now()}`,
      integration: 'STRIPE' as any,
      type: 'provisioning.failed',
      payload: { customer: 'cus_check', outcome: { reason: 'provisioning skipped (simulated bug)' } } as any,
      correlationId: 'corr_check',
    },
  });

  const incident = await prisma.incident.create({
    data: {
      integrationId: integration.id,
      invariantId: invariant.id,
      title: 'diagnosis check (temp)',
      description: 'temp',
      severity: 'LOW' as any,
      status: 'DETECTED' as any,
    },
  });

  try {
    const full = await prisma.incident.findUniqueOrThrow({
      where: { id: incident.id },
      include: { invariant: true, integration: true },
    });
    const d = await diagnoseIncident(full as any);
    console.log('rootCause:', d.rootCause);
    console.log('confidence:', d.confidence);
    console.log('evidence:', JSON.stringify(d.evidence));
    if (!d.rootCause.includes('provisioning.failed')) {
      throw new Error('diagnosis did not cite the tracked failure');
    }
    if (d.confidence < 0.9) throw new Error('expected high confidence');
    console.log('DIAGNOSIS CHECK OK');
  } finally {
    await prisma.incident.delete({ where: { id: incident.id } }).catch(() => undefined);
    await prisma.trackedEvent.delete({ where: { id: tracked.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch(e => {
  console.error('DIAGNOSIS CHECK FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
