// End-to-end: behavioral drift detection with a real database. Checks:
// - an improvement (70% -> 99%) never opens an incident,
// - a regression that starts mid-window is caught on the next pass even though a healthy
//   result was already recorded earlier in the same window,
// - severity follows percentage points lost (a 2% drop from a perfect baseline is not critical),
// - re-checking does not pile up duplicate results or incidents.
// Run: pnpm --filter @shapi/backend e2e:drift
const { prisma } = await import('../src/utils/prisma.js');
const { checkDrift } = await import('../src/routes/webhooks.js');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ok - ${message}`);
}

const runId = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;
const tenant = await prisma.tenant.create({ data: { name: `drift ${runId}`, slug: `drift-${runId}` } });

async function setup(label: string, baseline: [passed: number, total: number]) {
  const integration = await prisma.integration.create({ data: { tenantId: tenant.id, name: `${label} Stripe`, type: 'STRIPE', config: {} } });
  await prisma.driftDetectionConfig.create({ data: { integrationId: integration.id } }); // defaults: 1h window, 50 samples
  const invariant = await prisma.invariant.create({
    data: { integrationId: integration.id, name: `${label} rule`, description: 'x', predicateExpression: 'true', predicateDescription: 'x' },
  });
  const addEvaluation = (minutesAgo: number, passed: number, total: number) => prisma.invariantEvaluation.create({
    data: {
      invariantId: invariant.id, windowStart: new Date(Date.now() - minutesAgo * MIN), windowEnd: new Date(Date.now() - (minutesAgo - 1) * MIN),
      totalSamples: total, passedSamples: passed, successRate: passed / total, status: 'HEALTHY', details: {},
    },
  });
  await prisma.invariantEvaluation.create({
    data: {
      invariantId: invariant.id, windowStart: new Date(Date.now() - 3 * DAY), windowEnd: new Date(Date.now() - 3 * DAY + MIN),
      totalSamples: baseline[1], passedSamples: baseline[0], successRate: baseline[0] / baseline[1], status: 'HEALTHY', details: {},
    },
  });
  return { integration, invariant, addEvaluation };
}
const results = (invariantId: string) => prisma.driftResult.findMany({ where: { invariantId }, orderBy: { detectedAt: 'asc' } });
const incidents = (invariantId: string) => prisma.incident.findMany({ where: { invariantId } });

try {
  console.log('1. an improvement is not drift');
  const better = await setup('improving', [700, 1000]);
  await better.addEvaluation(10, 99, 100);
  await checkDrift(better.invariant.id);
  const betterResults = await results(better.invariant.id);
  assert(betterResults.length === 1 && betterResults[0].detected === false, 'the improvement is recorded as not detected');
  assert(betterResults[0].currentRate > betterResults[0].baselineRate && betterResults[0].pValue < 0.01, 'even though it is statistically significant');
  assert((await incidents(better.invariant.id)).length === 0, 'and no incident is opened');
  await checkDrift(better.invariant.id);
  assert((await results(better.invariant.id)).length === 1, 'checking again straight away does not store another healthy result');

  console.log('2. a regression that starts mid-window is caught');
  const worse = await setup('regressing', [990, 1000]);
  await worse.addEvaluation(40, 99, 100);
  await checkDrift(worse.invariant.id);
  assert((await results(worse.invariant.id)).length === 1 && (await incidents(worse.invariant.id)).length === 0, 'healthy so far: one healthy result, no incident');
  await worse.addEvaluation(5, 100, 300); // 100 of 300 passed in the newest window
  await checkDrift(worse.invariant.id);
  const worseResults = await results(worse.invariant.id);
  assert(worseResults.length === 2 && worseResults[1].detected === true, 'the next pass detects it, despite the earlier healthy result in the same window');
  const opened = await incidents(worse.invariant.id);
  assert(opened.length === 1 && opened[0].title.startsWith('Behavioral drift detected'), 'one drift incident is opened');
  assert(opened[0].severity === 'CRITICAL', `a drop of about 55 points is CRITICAL (got ${opened[0].severity})`);
  await checkDrift(worse.invariant.id);
  assert((await results(worse.invariant.id)).length === 2 && (await incidents(worse.invariant.id)).length === 1, 'no duplicate result or incident on the next pass');

  console.log('3. severity follows points lost, not the baseline');
  const tiny = await setup('perfect-baseline', [1000, 1000]);
  await tiny.addEvaluation(5, 98, 100);
  await checkDrift(tiny.invariant.id);
  const tinyIncidents = await incidents(tiny.invariant.id);
  assert(tinyIncidents.length === 1 && tinyIncidents[0].severity === 'MEDIUM', `100% -> 98% is MEDIUM, not CRITICAL (got ${tinyIncidents[0]?.severity})`);

  console.log('\nE2E DRIFT OK');
} finally {
  await prisma.integration.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.tenant.deleteMany({ where: { id: tenant.id } });
  await prisma.$disconnect();
}
