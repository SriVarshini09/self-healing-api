// Real-Stripe test of outcome checks (TEST MODE ONLY).
//
// Creates two test customers with paid subscriptions (Stripe's test card),
// so Stripe itself emits invoice.payment_succeeded events. Marks only one
// customer as provisioned in a scratch table, then lets SHAPI pull the events
// through Stripe's real Events API and run the outcome check. Expects one
// passed outcome, one paid-but-not-provisioned failure and an incident.
// Everything it creates in Stripe and in the database is removed at the end.
//
// Usage (key never printed, never committed):
//   pnpm --filter @shapi/backend stripe:live-test --key-file <path to file with STRIPE_TEST_KEY=sk_test_...>
import fs from 'node:fs';
import Stripe from 'stripe';
import pg from 'pg';

function readKey(): string {
  const index = process.argv.indexOf('--key-file');
  const file = index >= 0 ? process.argv[index + 1] : undefined;
  let key = process.env.STRIPE_TEST_KEY;
  if (file) {
    // Tolerate a UTF-8 byte-order mark (some Windows editors add one) and stray spaces.
    const line = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).map(l => l.trim())
      .find(l => l.startsWith('STRIPE_TEST_KEY='));
    key = line?.slice('STRIPE_TEST_KEY='.length).trim().replace(/^["']|["']$/g, '');
  }
  if (!key) throw new Error('STRIPE_TEST_KEY not found (pass --key-file <file> containing STRIPE_TEST_KEY=sk_test_...)');
  if (!key.startsWith('sk_test_')) {
    throw new Error('STRIPE_TEST_KEY must be a TEST-mode secret key (sk_test_...). Live keys are refused.');
  }
  return key;
}

const key = readKey();
const { default: Fastify } = await import('fastify');
const { registerPlugins } = await import('../src/plugins/index.js');
const { registerRoutes } = await import('../src/routes/index.js');
const { prisma } = await import('../src/utils/prisma.js');
const { processDueOutcomeRuns, reconcileOutcomeCheck } = await import('../src/services/outcome-checks.js');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ok - ${message}`);
}

const stripe = new Stripe(key);
const runTag = `shapi-live-test-${Date.now()}`;
const created: { customers: string[]; subscriptions: string[]; product?: string } = { customers: [], subscriptions: [] };
const app = Fastify();
await registerPlugins(app);
await registerRoutes(app);
await app.ready();
const auth = { 'x-api-key': process.env.SHAPI_API_KEY || 'shapi_demo_local_d3v_k3y_9f2c' };
const dbUrl = (process.env.OUTCOME_E2E_DATABASE_URL || process.env.DATABASE_URL!).split('?')[0];
const db = new pg.Client({ connectionString: dbUrl });
await db.connect();
let checkId: string | undefined;

try {
  console.log('1. create real test-mode payments in Stripe');
  const account = await stripe.accounts.retrieve();
  assert(account.id.startsWith('acct_'), 'key works against the Stripe API (test mode)');
  const product = await stripe.products.create({ name: 'SHAPI live test plan', metadata: { shapi: runTag } });
  created.product = product.id;
  const price = await stripe.prices.create({ product: product.id, unit_amount: 500, currency: 'usd', recurring: { interval: 'month' } });
  const startedAt = Math.floor(Date.now() / 1000) - 5;
  for (const label of ['provisioned', 'stuck']) {
    const customer = await stripe.customers.create({
      email: `${label}+${Date.now()}@example.com`,
      metadata: { shapi: runTag },
      payment_method: 'pm_card_visa',
      invoice_settings: { default_payment_method: 'pm_card_visa' },
    });
    created.customers.push(customer.id);
    const subscription = await stripe.subscriptions.create({ customer: customer.id, items: [{ price: price.id }], metadata: { shapi: runTag } });
    created.subscriptions.push(subscription.id);
    assert(subscription.status === 'active', `${label} customer subscribed and paid (${subscription.status})`);
  }
  const [okCustomer, stuckCustomer] = created.customers;

  console.log('2. scratch "customer app" table: only one customer was provisioned');
  await db.query('DROP TABLE IF EXISTS shapi_live_test_users');
  await db.query('CREATE TABLE shapi_live_test_users (stripe_customer_id text PRIMARY KEY, plan_status text NOT NULL)');
  await db.query("INSERT INTO shapi_live_test_users VALUES ($1, 'active')", [okCustomer]);

  console.log('3. outcome check with the Stripe key (no webhook involved)');
  const integration = await prisma.integration.findFirst({ where: { type: 'STRIPE' }, orderBy: { createdAt: 'asc' } });
  if (!integration) throw new Error('No Stripe integration in the SHAPI database (run pnpm db:seed)');
  const createdCheck = await app.inject({
    method: 'POST', url: '/api/v1/outcome-checks', headers: auth,
    payload: {
      integrationId: integration.id,
      name: `Live Stripe test ${runTag}`,
      triggerEventType: 'invoice.payment_succeeded',
      sql: "SELECT 1 FROM shapi_live_test_users WHERE stripe_customer_id = :customer AND plan_status = 'active'",
      paramBindings: { customer: 'data.object.customer' },
      deadlineSec: 30,
      databaseUrl: dbUrl,
      stripeApiKey: key,
    },
  });
  assert(createdCheck.statusCode === 201, `check created (${createdCheck.statusCode})`);
  checkId = JSON.parse(createdCheck.body).id as string;

  console.log("4. reconcile through Stripe's real Events API");
  const check = await prisma.outcomeCheck.findUniqueOrThrow({ where: { id: checkId } });
  let reconciled = { eventsSeen: 0, runsQueued: 0 };
  let ours: Array<{ params: unknown }> = [];
  for (let attempt = 0; attempt < 10; attempt++) {
    // Stripe can take a few seconds to make new events listable.
    reconciled = await reconcileOutcomeCheck(check, startedAt, new Date());
    ours = (await prisma.outcomeCheckRun.findMany({ where: { checkId } }))
      .filter(run => created.customers.includes((run.params as { customer?: string }).customer ?? ''));
    if (ours.length >= 2) break;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  assert(reconciled.eventsSeen >= 2, `Stripe Events API returned this run's payment events (${reconciled.eventsSeen} seen)`);
  assert(ours.length === 2, 'one run queued per test payment');

  console.log('5. after the deadline');
  const result = await processDueOutcomeRuns(new Date(Date.now() + 31_000));
  const runs = await prisma.outcomeCheckRun.findMany({ where: { checkId } });
  const statusFor = (customer: string) => runs.find(run => (run.params as { customer?: string }).customer === customer)?.status;
  assert(statusFor(okCustomer) === 'PASSED', 'provisioned customer passed');
  assert(statusFor(stuckCustomer) === 'FAILED', 'paid-but-not-provisioned customer failed');
  const incident = await prisma.incident.findFirst({ where: { invariantId: `outcome-${checkId}` } });
  assert(incident, `incident opened (${JSON.stringify(result)})`);
  console.log('\nLIVE STRIPE TEST OK');
} finally {
  for (const id of created.subscriptions) await stripe.subscriptions.cancel(id).catch(() => undefined);
  for (const id of created.customers) await stripe.customers.del(id).catch(() => undefined);
  if (created.product) await stripe.products.update(created.product, { active: false }).catch(() => undefined);
  if (checkId) await app.inject({ method: 'DELETE', url: `/api/v1/outcome-checks/${checkId}`, headers: auth });
  await db.query('DROP TABLE IF EXISTS shapi_live_test_users').catch(() => undefined);
  await db.end();
  await app.close();
  await prisma.$disconnect();
  console.log('cleanup done (test customers deleted, subscriptions canceled, product archived)');
}
