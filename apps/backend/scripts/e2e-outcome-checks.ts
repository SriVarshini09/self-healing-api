// End-to-end: Stripe event -> outcome check against a real database -> incident.
//
// Uses the seeded demo tenant/integration and creates a throwaway customer
// table in the SHAPI database itself (standing in for the customer's app DB).
// Run: pnpm --filter @shapi/backend e2e:outcomes
import Fastify from 'fastify';
import pg from 'pg';
import { registerPlugins } from '../src/plugins/index.js';
import { registerRoutes } from '../src/routes/index.js';
import { prisma } from '../src/utils/prisma.js';
import { runOutcomeQuery } from '@shapi/outcome-checks';
import { processDueOutcomeRuns, reconcileOutcomeCheck } from '../src/services/outcome-checks.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ok - ${message}`);
}

const stripeEvent = (id: string, customer: string, created = Math.floor(Date.now() / 1000)) => ({
  id,
  object: 'event',
  type: 'invoice.payment_succeeded',
  created,
  data: { object: { object: 'invoice', customer, amount_paid: 4900, status: 'paid' } },
});

async function main() {
  const app = Fastify();
  await registerPlugins(app);
  await registerRoutes(app);
  await app.ready();
  const auth = { 'x-api-key': process.env.SHAPI_API_KEY || 'shapi_demo_local_d3v_k3y_9f2c' };
  const json = (r: { body: string }) => JSON.parse(r.body);

  // Customer database stand-in. Drop Prisma's ?schema= parameter for node-postgres.
  const customerDbUrl = (process.env.OUTCOME_E2E_DATABASE_URL || process.env.DATABASE_URL!).split('?')[0];
  const db = new pg.Client({ connectionString: customerDbUrl });
  await db.connect();
  await db.query('DROP TABLE IF EXISTS e2e_customer_users');
  await db.query('CREATE TABLE e2e_customer_users (stripe_customer_id text PRIMARY KEY, plan_status text NOT NULL)');
  await db.query("INSERT INTO e2e_customer_users VALUES ('cus_e2e_ok', 'active'), ('cus_e2e_stuck', 'pending')");

  const integration = await prisma.integration.findFirst({ where: { type: 'STRIPE' }, orderBy: { createdAt: 'asc' } });
  if (!integration) throw new Error('seeded Stripe integration missing - run pnpm db:seed');
  const runId = Date.now();
  let checkId: string | undefined;

  try {
    console.log('1. validation');
    const badSql = await app.inject({ method: 'POST', url: '/api/v1/outcome-checks', headers: auth, payload: {
      integrationId: integration.id, name: 'bad', triggerEventType: 'invoice.payment_succeeded',
      sql: 'DELETE FROM e2e_customer_users', paramBindings: {}, databaseUrl: customerDbUrl,
    } });
    assert(badSql.statusCode === 400, 'write SQL is rejected');
    const liveKey = await app.inject({ method: 'POST', url: '/api/v1/outcome-checks', headers: auth, payload: {
      integrationId: integration.id, name: 'bad', triggerEventType: 'invoice.payment_succeeded',
      sql: 'SELECT 1 FROM e2e_customer_users WHERE stripe_customer_id = :customer',
      paramBindings: { customer: 'data.object.customer' }, databaseUrl: customerDbUrl, stripeApiKey: 'sk_live_abc123',
    } });
    assert(liveKey.statusCode === 400, 'live secret Stripe key is rejected (restricted key required)');

    console.log('2. create check');
    const created = await app.inject({ method: 'POST', url: '/api/v1/outcome-checks', headers: auth, payload: {
      integrationId: integration.id,
      name: `Paid customers are provisioned (e2e ${runId})`,
      triggerEventType: 'invoice.payment_succeeded',
      sql: "SELECT 1 FROM e2e_customer_users WHERE stripe_customer_id = :customer AND plan_status = 'active'",
      paramBindings: { customer: 'data.object.customer' },
      deadlineSec: 60,
      databaseUrl: customerDbUrl,
      stripeApiKey: 'rk_test_e2eplaceholder',
    } });
    assert(created.statusCode === 201, `check created (${created.statusCode})`);
    const check = json(created);
    checkId = check.id;
    assert(!JSON.stringify(check).includes(customerDbUrl), 'API response never contains the database URL');
    assert(!JSON.stringify(check).includes('rk_test_e2eplaceholder'), 'API response never contains the Stripe key');
    assert(await prisma.invariant.findUnique({ where: { id: check.invariantId } }), 'backing invariant created');

    console.log('3. dry run');
    const dry = await app.inject({ method: 'POST', url: `/api/v1/outcome-checks/${checkId}/test`, headers: auth,
      payload: { event: stripeEvent('evt_dry', 'cus_e2e_ok') } });
    assert(dry.statusCode === 200 && json(dry).matched === true, 'dry run finds the provisioned customer');
    const dryStuck = await app.inject({ method: 'POST', url: `/api/v1/outcome-checks/${checkId}/test`, headers: auth,
      payload: { event: stripeEvent('evt_dry2', 'cus_e2e_stuck') } });
    assert(json(dryStuck).matched === false, 'dry run does not find the stuck customer');

    console.log('4. webhooks -> runs');
    for (const [eventId, customer] of [[`evt_e2e_ok_${runId}`, 'cus_e2e_ok'], [`evt_e2e_stuck_${runId}`, 'cus_e2e_stuck']]) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': 'test' },
        payload: stripeEvent(eventId, customer) });
      assert(res.statusCode === 200, `webhook ${eventId} accepted`);
    }
    let runs = [] as Awaited<ReturnType<typeof prisma.outcomeCheckRun.findMany>>;
    for (let i = 0; i < 50 && runs.length < 2; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      runs = await prisma.outcomeCheckRun.findMany({ where: { checkId } });
    }
    assert(runs.length === 2 && runs.every(run => run.status === 'PENDING'), 'two runs queued, waiting for the deadline');

    const early = await processDueOutcomeRuns(new Date());
    assert(early.processed === 0, 'nothing runs before the deadline');

    console.log('5. deadline passes');
    const later = new Date(Date.now() + 61_000);
    const result = await processDueOutcomeRuns(later);
    assert(result.passed === 1 && result.failed === 1, `1 passed, 1 failed (${JSON.stringify(result)})`);
    const incident = await prisma.incident.findFirst({ where: { invariantId: check.invariantId } });
    assert(incident && incident.status === 'DETECTED', 'paid-but-not-provisioned opened an incident');

    console.log('6. Stripe reconcile (no webhook needed), with a stubbed Events API');
    await db.query("INSERT INTO e2e_customer_users VALUES ('cus_e2e_late', 'active')");
    const stored = await prisma.outcomeCheck.findUniqueOrThrow({ where: { id: checkId } });
    const reconciled = await reconcileOutcomeCheck(stored, 0, later, {
      runQuery: runOutcomeQuery,
      listStripeEvents: async () => [
        stripeEvent(`evt_e2e_ok_${runId}`, 'cus_e2e_ok'),
        stripeEvent(`evt_e2e_late_${runId}`, 'cus_e2e_late'),
      ],
    });
    assert(reconciled.eventsSeen === 2 && reconciled.runsQueued === 1, 'reconcile skips the event the webhook already queued');
    const afterReconcile = await processDueOutcomeRuns(later);
    assert(afterReconcile.passed === 1, 'reconciled event checked and passed');

    const list = await app.inject({ method: 'GET', url: '/api/v1/outcome-checks', headers: auth });
    const listed = json(list).data.find((c: { id: string }) => c.id === checkId);
    assert(listed.runsLast24h.PASSED === 2 && listed.runsLast24h.FAILED === 1, 'list shows 2 passed / 1 failed');
    console.log('\nE2E OUTCOME CHECKS OK');
  } finally {
    if (checkId) {
      await app.inject({ method: 'DELETE', url: `/api/v1/outcome-checks/${checkId}`, headers: auth });
    }
    await db.query('DROP TABLE IF EXISTS e2e_customer_users');
    await db.end();
    await app.close();
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
