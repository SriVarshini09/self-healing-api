// nextjs/saas-starter: Next.js + Postgres (Drizzle) + Stripe, ~16k stars.
// Its webhook handler updates the `teams` table directly from the event, so
// the real, unmodified handler can run against a real database here.
import type { Kit, StripeEventFixture } from './types.js';

const API_VERSION = '2025-04-30.basil';
let sequence = 0;

function subscriptionEvent(
  type: string,
  sub: { id: string; customer: string; status: string; product: string },
): StripeEventFixture {
  sequence += 1;
  return {
    id: `evt_bench_${sequence}`,
    object: 'event',
    type,
    created: 1_790_000_000 + sequence,
    livemode: false,
    api_version: API_VERSION,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: sub.id,
        object: 'subscription',
        customer: sub.customer,
        status: sub.status,
        // Webhook payloads are never expanded: plan.product is an id string.
        items: {
          object: 'list',
          data: [{
            id: `si_${sub.id}`,
            object: 'subscription_item',
            plan: { id: `price_${sub.product}`, object: 'plan', product: sub.product, interval: 'month' },
            price: { id: `price_${sub.product}`, object: 'price', product: sub.product },
          }],
        },
      },
    },
  };
}

const ROUTE = 'app/api/stripe/webhook/route.ts';
const STRIPE_LIB = 'lib/payments/stripe.ts';
const QUERIES = 'lib/db/queries.ts';

export const saasStarter: Kit = {
  name: 'saas-starter',
  repo: 'nextjs/saas-starter',
  commit: '6e33e58b1e553a41fe22e6b941a7229a002de361',
  license: 'MIT (c) 2025 Vercel',
  mustDetect: ['M1-drop-updated-case', 'M2-wrong-id-field', 'M3-status-filter', 'M4-inverted-guard',
    'M5-copy-paste-null', 'M6-cancel-keeps-subscription', 'M7-drop-deleted-case', 'M8-wrong-lookup-column', 'M10-renamed-secret-env'],
  routeFile: ROUTE,
  schemaFiles: ['lib/db/migrations/0000_soft_the_anarchist.sql'],
  databaseEnvVar: 'POSTGRES_URL',
  webhookSecret: 'whsec_benchmark_only',
  env: {
    STRIPE_SECRET_KEY: 'sk_test_benchmark_not_a_real_key',
    STRIPE_WEBHOOK_SECRET: 'whsec_benchmark_only',
    AUTH_SECRET: 'benchmark-auth-secret-not-used',
    BASE_URL: 'http://localhost:3000',
  },

  scenarios: [
    {
      id: 'activate',
      description: 'Paid subscription becomes active; the team must get the subscription',
      // As after checkout: the team knows its Stripe customer id, nothing else yet.
      seedSql: ["INSERT INTO teams (name, stripe_customer_id) VALUES ('Team A', 'cus_bench_a')"],
      events: [subscriptionEvent('customer.subscription.updated', {
        id: 'sub_bench_a', customer: 'cus_bench_a', status: 'active', product: 'prod_bench_pro',
      })],
    },
    {
      id: 'upgrade',
      description: 'Customer upgrades Base -> Plus in the Stripe customer portal',
      seedSql: [`INSERT INTO teams (name, stripe_customer_id, stripe_subscription_id, stripe_product_id, plan_name, subscription_status)
        VALUES ('Team C', 'cus_bench_c', 'sub_bench_c', 'prod_bench_base', 'Base', 'active')`],
      events: [subscriptionEvent('customer.subscription.updated', {
        id: 'sub_bench_c', customer: 'cus_bench_c', status: 'active', product: 'prod_bench_plus',
      })],
    },
    {
      id: 'cancel',
      description: 'Subscription is canceled; the team must lose the subscription',
      seedSql: [`INSERT INTO teams (name, stripe_customer_id, stripe_subscription_id, stripe_product_id, plan_name, subscription_status)
        VALUES ('Team B', 'cus_bench_b', 'sub_bench_b', 'prod_bench_pro', 'Pro', 'active')`],
      events: [subscriptionEvent('customer.subscription.deleted', {
        id: 'sub_bench_b', customer: 'cus_bench_b', status: 'canceled', product: 'prod_bench_pro',
      })],
    },
  ],

  // Written the way a customer would describe "provisioned" in their own schema.
  checks: [
    {
      id: 'subscription-applied',
      name: 'An active subscription update is applied to the team',
      triggerEventType: 'customer.subscription.updated',
      sql: `SELECT 1 FROM teams
            WHERE stripe_customer_id = :customer
              AND stripe_subscription_id = :subscription
              AND stripe_product_id = :product
              AND subscription_status = :status`,
      paramBindings: {
        customer: 'data.object.customer',
        subscription: 'data.object.id',
        product: 'data.object.items.data.0.plan.product',
        status: 'data.object.status',
      },
    },
    {
      id: 'cancellation-applied',
      name: 'A canceled subscription removes access',
      triggerEventType: 'customer.subscription.deleted',
      sql: `SELECT 1 FROM teams
            WHERE stripe_customer_id = :customer
              AND stripe_subscription_id IS NULL
              AND subscription_status = 'canceled'`,
      paramBindings: { customer: 'data.object.customer' },
    },
  ],

  probes: [
    {
      id: 'plan-name-after-upgrade',
      description: 'After a portal upgrade (Base -> Plus), plan_name should change with stripe_product_id',
      sql: "SELECT plan_name, stripe_product_id FROM teams WHERE stripe_customer_id = 'cus_bench_c'",
      evaluate: rows => {
        const row = rows[0];
        if (!row) return 'team row missing';
        return row.stripe_product_id === 'prod_bench_plus' && row.plan_name === 'Base'
          ? 'stripe_product_id moved to the new product but plan_name stayed "Base": the handler reads (plan.product as Stripe.Product).name, but webhook payloads carry plan.product as an id string, so the name is undefined and Drizzle skips the column'
          : null;
      },
    },
  ],

  mutations: [
    {
      id: 'M1-drop-updated-case',
      title: 'customer.subscription.updated no longer handled',
      expected: 'silent',
      modeledOn: 'A switch case lost in a refactor; the default branch logs and returns 200',
      file: ROUTE,
      before: "    case 'customer.subscription.updated':\n",
      after: '',
    },
    {
      id: 'M2-wrong-id-field',
      title: 'Team looked up by subscription id instead of customer id',
      expected: 'silent',
      modeledOn: 'Confusing subscription.id with subscription.customer',
      file: STRIPE_LIB,
      before: 'const customerId = subscription.customer as string;',
      after: 'const customerId = subscription.id;',
    },
    {
      id: 'M3-status-filter',
      title: "Only 'trialing' treated as active",
      expected: 'silent',
      modeledOn: 'Status allow-list narrowed while adding trials',
      file: STRIPE_LIB,
      before: "if (status === 'active' || status === 'trialing') {",
      after: "if (status === 'trialing') {",
    },
    {
      id: 'M4-inverted-guard',
      title: 'Not-found guard inverted',
      expected: 'silent',
      modeledOn: 'if (!team) typo: returns early exactly when the team exists',
      file: STRIPE_LIB,
      before: 'if (!team) {',
      after: 'if (team) {',
    },
    {
      id: 'M5-copy-paste-null',
      title: 'Active branch writes a null subscription id',
      expected: 'silent',
      modeledOn: 'Copy-paste from the cancel branch',
      file: STRIPE_LIB,
      before: 'stripeSubscriptionId: subscriptionId,',
      after: 'stripeSubscriptionId: null,',
    },
    {
      id: 'M6-cancel-keeps-subscription',
      title: 'Cancel branch keeps the subscription id',
      expected: 'silent',
      modeledOn: 'Canceled customers keep access (revenue leak)',
      file: STRIPE_LIB,
      before: '      stripeSubscriptionId: null,\n      stripeProductId: null,',
      after: '      stripeSubscriptionId: subscriptionId,\n      stripeProductId: null,',
    },
    {
      id: 'M7-drop-deleted-case',
      title: 'customer.subscription.deleted no longer handled',
      expected: 'silent',
      modeledOn: 'Cancellation webhook never wired up',
      file: ROUTE,
      before: "    case 'customer.subscription.deleted':\n",
      after: '',
    },
    {
      id: 'M8-wrong-lookup-column',
      title: 'Lookup query filters the wrong column',
      expected: 'silent',
      modeledOn: 'Query helper edited to the wrong column',
      file: QUERIES,
      before: '.where(eq(teams.stripeCustomerId, customerId))',
      after: '.where(eq(teams.stripeSubscriptionId, customerId))',
    },
    {
      id: 'M9-unawaited-write',
      title: 'Database write not awaited',
      expected: 'silent',
      modeledOn: 'Floating promise; on serverless the function can freeze before the write lands',
      file: STRIPE_LIB,
      before: '    await updateTeamSubscription(team.id, {\n      stripeSubscriptionId: subscriptionId,',
      after: '    void updateTeamSubscription(team.id, {\n      stripeSubscriptionId: subscriptionId,',
    },
    {
      id: 'M10-renamed-secret-env',
      title: 'Webhook secret read from a renamed env var',
      expected: 'loud',
      modeledOn: 'Env var renamed in code but not in the deployment: signature check fails with 400',
      file: ROUTE,
      before: 'const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;',
      after: 'const webhookSecret = process.env.STRIPE_WEBHOOK_SIGNING_SECRET!;',
    },
  ],
};
