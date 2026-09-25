import Fastify from 'fastify';
import { registerPlugins } from '../src/plugins/index.js';
import { registerRoutes } from '../src/routes/index.js';
import { prisma } from '../src/utils/prisma.js';

async function main() {
  const app = Fastify();
  await registerPlugins(app);
  await registerRoutes(app);
  await app.ready();
  const j = (r: any) => JSON.parse(r.body);

  const inv = await prisma.invariant.findFirst({ where: { id: 'inv-stripe-payment-succeeded' } });
  if (!inv) throw new Error('seed invariant missing');

  // Lower detection threshold for test speed; push old seed evals outside detection window
  await prisma.driftDetectionConfig.upsert({
    where: { integrationId: inv.integrationId },
    update: { minDetectionSamples: 5, detectionWindowHours: 1 },
    create: { integrationId: inv.integrationId, minDetectionSamples: 5, detectionWindowHours: 1 },
  });
  // Reset: 12 good evaluations 2 days ago (baseline), then failing ones now (current)
  await prisma.invariantEvaluation.deleteMany({ where: { invariantId: inv.id } });
  const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
  for (let i = 0; i < 12; i++) {
    const ws = new Date(twoDaysAgo - (i + 1) * 5 * 60 * 1000);
    await prisma.invariantEvaluation.create({
      data: {
        invariantId: inv.id,
        windowStart: ws,
        windowEnd: new Date(ws.getTime() + 5 * 60 * 1000),
        totalSamples: 20,
        passedSamples: 20,
        successRate: 1,
        status: 'HEALTHY' as any,
      },
    });
  }

  // Create 6 failing evaluations in current window
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    await prisma.invariantEvaluation.create({
      data: {
        invariantId: inv.id,
        windowStart: new Date(now.getTime() - (i + 1) * 10 * 60 * 1000),
        windowEnd: new Date(now.getTime() - i * 10 * 60 * 1000),
        totalSamples: 20,
        passedSamples: 8, // 40% success vs 99% expected
        successRate: 0.4,
        status: 'VIOLATED' as any,
      },
    });
  }

  const KEY = process.env.SHAPI_API_KEY || 'shapi_demo_local_d3v_k3y_9f2c';
  const auth = { 'x-api-key': KEY };

  const check = await app.inject({
    method: 'POST',
    url: `/api/v1/drift/check/${inv.id}`,
    headers: auth,
  });
  console.log('drift check:', check.statusCode, check.body.slice(0, 300));
  if (check.statusCode !== 200) throw new Error('drift check failed');
  if (!j(check).detected) throw new Error('expected drift detected');

  const incidents = await app.inject({ method: 'GET', url: '/api/v1/incidents?pageSize=5', headers: auth });
  const list = j(incidents).data;
  console.log('incidents:', list.length, list[0]?.title);
  if (list.length === 0) throw new Error('expected incident created');

  const id = list[0].id;
  const diag = await app.inject({ method: 'POST', url: `/api/v1/incidents/${id}/diagnose`, headers: auth });
  console.log('diagnose:', diag.statusCode);
  if (diag.statusCode !== 200) throw new Error('diagnose failed: ' + diag.body);
  const d = j(diag);
  console.log('rootCause:', d.diagnosis?.rootCause?.slice(0, 120));
  console.log('candidates:', d.candidates?.length);
  if (!d.candidates?.length) throw new Error('expected repair candidates');

  const detail = await app.inject({ method: 'GET', url: `/api/v1/incidents/${id}`, headers: auth });
  const det = j(detail);
  console.log('status:', det.status, '| repairs:', det.repairCandidates?.length);
  if (det.status !== 'TRIAGED') throw new Error('expected TRIAGED');

  // Replay: pick a real webhook event
  const ev = await prisma.webhookEvent.findFirst({ where: { integrationId: inv.integrationId } });
  if (!ev) throw new Error('no webhook event');
  const replay = await app.inject({
    method: 'POST',
    url: `/api/v1/incidents/${id}/replay`,
    headers: { 'content-type': 'application/json', ...auth },
    payload: { webhookEventId: ev.id, fixCandidate: 'add_field:status:"paid"' },
  });
  console.log('replay:', replay.statusCode);
  if (replay.statusCode !== 201) throw new Error('replay failed');

  await app.close();
  await prisma.$disconnect();
  console.log('INCIDENT E2E OK');
}

main().catch(async e => {
  console.error('INCIDENT E2E FAILED:', e);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});
