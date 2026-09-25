import { prisma } from '../src/utils/prisma.js';

const [incidents, webhooks, invariants, evals] = await Promise.all([
  prisma.incident.count(),
  prisma.webhookEvent.count(),
  prisma.invariant.count(),
  prisma.invariantEvaluation.count(),
]);
console.log(JSON.stringify({ incidents, webhooks, invariants, evals }));
await prisma.$disconnect();
