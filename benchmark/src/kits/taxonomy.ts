// shadcn-ui/taxonomy: Next.js + Prisma + Stripe, ~19k stars. Its webhook handler
// is shaped differently from saas-starter's: on each event it calls back into the
// Stripe API (subscriptions.retrieve) and then updates a `User` row through Prisma.
//
// The kit targets MySQL (PlanetScale). SHAPI's outcome checks read Postgres, so
// `prepare` switches the Prisma datasource provider to postgresql before generating
// the client and the schema. The webhook handler, the Prisma models and `lib/db.ts`
// are untouched; only that one datasource line changes.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Kit, StripeEventFixture } from './types.js';

const OLD_API_VERSION = '2022-11-15';
const NEW_API_VERSION = '2025-04-30.basil';
// 2030-01-01: comfortably in the future, so "period end is in the future" holds.
const PERIOD_END = 1_893_456_000;
let sequence = 0;

function event(type: string, object: Record<string, unknown>, apiVersion = OLD_API_VERSION): StripeEventFixture {
  sequence += 1;
  return {
    id: `evt_bench_tax_${sequence}`,
    object: 'event',
    type,
    created: 1_790_000_000 + sequence,
    livemode: false,
    api_version: apiVersion,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object },
  };
}

function subscription(id: string, customer: string, price: string): Record<string, unknown> {
  return {
    id,
    object: 'subscription',
    customer,
    status: 'active',
    current_period_end: PERIOD_END,
    items: { object: 'list', data: [{ id: `si_${id}`, object: 'subscription_item', price: { id: price, object: 'price' } }] },
  };
}

const ROUTE = 'app/api/webhooks/stripe/route.ts';

function prepare(kitDir: string): void {
  const require = createRequire(import.meta.url);
  const prisma = require.resolve('prisma/build/index.js');
  const schema = join(kitDir, 'prisma', 'schema.prisma');
  const original = readFileSync(schema, 'utf8');
  if (!original.includes('provider = "mysql"')) throw new Error('taxonomy schema no longer uses the mysql provider; update the benchmark patch');
  writeFileSync(schema, original.replace('provider = "mysql"', 'provider = "postgresql"'));
  const env = { ...process.env, DATABASE_URL: 'postgresql://benchmark:benchmark@127.0.0.1:5432/benchmark' };
  const run = (...args: string[]) => execFileSync(process.execPath, [prisma, ...args], { cwd: kitDir, env, stdio: 'pipe' }).toString();
  run('generate', '--schema', schema);
  writeFileSync(join(kitDir, 'benchmark-schema.sql'), run('migrate', 'diff', '--from-empty', '--to-schema-datamodel', schema, '--script'));
}

export const taxonomy: Kit = {
  name: 'taxonomy',
  repo: 'shadcn-ui/taxonomy',
  commit: '298a8857c7128a0d121e7f699dfd729f23b3966d',
  license: 'MIT (c) 2023 shadcn',
  mustDetect: ['T1-drop-checkout-case', 'T2-drop-renewal-case', 'T3-wrong-subscription-id', 'T4-null-customer',
    'T5-renewal-keeps-old-period', 'T6-period-in-seconds', 'T7-unawaited-write', 'T8-missing-user-metadata', 'T9-renamed-secret-env'],
  prepare,
  routeFile: ROUTE,
  schemaFiles: ['benchmark-schema.sql'],
  databaseEnvVar: 'DATABASE_URL',
  webhookSecret: 'whsec_benchmark_only',
  env: {
    NEXTAUTH_SECRET: 'benchmark-not-used',
    GITHUB_CLIENT_ID: 'x',
    GITHUB_CLIENT_SECRET: 'x',
    GITHUB_ACCESS_TOKEN: 'x',
    SMTP_FROM: 'bench@example.com',
    POSTMARK_API_TOKEN: 'x',
    POSTMARK_SIGN_IN_TEMPLATE: 'x',
    POSTMARK_ACTIVATION_TEMPLATE: 'x',
    STRIPE_API_KEY: 'sk_test_benchmark_not_a_real_key',
    STRIPE_WEBHOOK_SECRET: 'whsec_benchmark_only',
    STRIPE_PRO_MONTHLY_PLAN_ID: 'price_pro',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  },

  // What the handler gets back when it asks Stripe for the subscription.
  stripeApi: {
    subscriptions: {
      sub_tax_a: subscription('sub_tax_a', 'cus_tax_a', 'price_pro'),
      sub_tax_b: subscription('sub_tax_b', 'cus_tax_b', 'price_plus'),
      sub_tax_c: subscription('sub_tax_c', 'cus_tax_c', 'price_pro'),
    },
  },

  scenarios: [
    {
      id: 'first-payment',
      description: 'Checkout completes; the user must get the subscription, customer id, price and a future period end',
      // The user exists before checkout; the checkout session carries their id in metadata.
      seedSql: ["INSERT INTO users (id, name, email, updated_at) VALUES ('user_tax_a', 'User A', 'a@example.com', now())"],
      events: [event('checkout.session.completed', {
        id: 'cs_bench_a', object: 'checkout.session', mode: 'subscription',
        customer: 'cus_tax_a', subscription: 'sub_tax_a', metadata: { userId: 'user_tax_a' },
      })],
    },
    {
      id: 'renewal',
      description: 'A renewal invoice is paid; the user must move to the new price and a future period end',
      // Already subscribed, but the period ended in the past and the price is the old one.
      seedSql: [`INSERT INTO users (id, name, email, updated_at, stripe_customer_id, stripe_subscription_id, stripe_price_id, stripe_current_period_end)
        VALUES ('user_tax_b', 'User B', 'b@example.com', now(), 'cus_tax_b', 'sub_tax_b', 'price_pro', now() - interval '30 days')`],
      events: [event('invoice.payment_succeeded', {
        id: 'in_bench_b', object: 'invoice', customer: 'cus_tax_b', subscription: 'sub_tax_b',
      })],
    },
    {
      id: 'renewal-new-api-version',
      description: 'The same renewal on a Stripe account using API version 2025-03-31 or later (invoice.subscription was removed)',
      seedSql: [`INSERT INTO users (id, name, email, updated_at, stripe_customer_id, stripe_subscription_id, stripe_price_id, stripe_current_period_end)
        VALUES ('user_tax_c', 'User C', 'c@example.com', now(), 'cus_tax_c', 'sub_tax_c', 'price_pro', now() - interval '30 days')`],
      events: [event('invoice.payment_succeeded', {
        id: 'in_bench_c', object: 'invoice', customer: 'cus_tax_c',
        parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_tax_c' } },
      }, NEW_API_VERSION)],
      knownIssue: 'On Stripe API version 2025-03-31.basil or later, an invoice no longer has a top-level `subscription` field (it moved to `parent.subscription_details.subscription`). The kit\'s invoice.payment_succeeded handler reads `session.subscription`, which is undefined, so `stripe.subscriptions.retrieve(undefined)` throws, the webhook returns 500, and the renewal never reaches the user row. Every renewal fails the same way until Stripe gives up retrying.',
    },
  ],

  checks: [
    {
      id: 'subscription-recorded',
      name: 'A completed checkout gives the user their subscription',
      triggerEventType: 'checkout.session.completed',
      sql: `SELECT 1 FROM users
            WHERE id = :user
              AND stripe_customer_id = :customer
              AND stripe_subscription_id = :subscription
              AND stripe_price_id IS NOT NULL
              AND stripe_current_period_end > now()`,
      paramBindings: {
        user: 'data.object.metadata.userId',
        customer: 'data.object.customer',
        subscription: 'data.object.subscription',
      },
    },
    {
      id: 'renewal-recorded',
      name: 'A paid renewal extends the user\'s period',
      triggerEventType: 'invoice.payment_succeeded',
      // Keyed on the customer, which every API version puts on the invoice.
      sql: `SELECT 1 FROM users
            WHERE stripe_customer_id = :customer
              AND stripe_current_period_end > now()`,
      paramBindings: { customer: 'data.object.customer' },
    },
  ],

  probes: [],

  mutations: [
    {
      id: 'T1-drop-checkout-case',
      title: 'checkout.session.completed no longer handled',
      expected: 'silent',
      modeledOn: 'Event name changed during a refactor (e.g. switched to async_payment_succeeded); the handler still returns 200',
      file: ROUTE,
      before: 'if (event.type === "checkout.session.completed") {',
      after: 'if (event.type === "checkout.session.async_payment_succeeded") {',
    },
    {
      id: 'T2-drop-renewal-case',
      title: 'invoice.payment_succeeded no longer handled',
      expected: 'silent',
      modeledOn: 'Renewal handling lost or pointed at the wrong event (payment_failed); renewals stop extending access',
      file: ROUTE,
      before: 'if (event.type === "invoice.payment_succeeded") {',
      after: 'if (event.type === "invoice.payment_failed") {',
    },
    {
      id: 'T3-wrong-subscription-id',
      title: 'Stores the checkout session id as the subscription id',
      expected: 'silent',
      modeledOn: 'Confusing session.id with subscription.id',
      file: ROUTE,
      before: 'stripeSubscriptionId: subscription.id,\n        stripeCustomerId',
      after: 'stripeSubscriptionId: session.id,\n        stripeCustomerId',
    },
    {
      id: 'T4-null-customer',
      title: 'Customer id never saved',
      expected: 'silent',
      modeledOn: 'Field dropped while renaming columns',
      file: ROUTE,
      before: 'stripeCustomerId: subscription.customer as string,',
      after: 'stripeCustomerId: null,',
    },
    {
      id: 'T5-renewal-keeps-old-period',
      title: 'Renewal updates the price but not the period end',
      expected: 'silent',
      modeledOn: 'Field omitted from the update; the user is cut off at the old period end despite paying',
      file: ROUTE,
      before: '        stripePriceId: subscription.items.data[0].price.id,\n        stripeCurrentPeriodEnd: new Date(\n          subscription.current_period_end * 1000\n        ),\n      },\n    })\n  }\n\n  return',
      after: '        stripePriceId: subscription.items.data[0].price.id,\n      },\n    })\n  }\n\n  return',
    },
    {
      id: 'T6-period-in-seconds',
      title: 'Period end stored as seconds treated as milliseconds',
      expected: 'silent',
      modeledOn: 'Missing `* 1000` when converting a Stripe timestamp; the period ends in January 1970',
      file: ROUTE,
      before: 'new Date(\n          subscription.current_period_end * 1000\n        ),\n      },\n    })\n  }\n\n  if (event.type === "invoice.payment_succeeded")',
      after: 'new Date(\n          subscription.current_period_end\n        ),\n      },\n    })\n  }\n\n  if (event.type === "invoice.payment_succeeded")',
    },
    {
      id: 'T7-unawaited-write',
      title: 'Checkout write not awaited',
      expected: 'silent',
      modeledOn: 'Missing `await`. Prisma queries are lazy, so a query nobody awaits never runs at all: the handler returns 200 and the user is never updated',
      file: ROUTE,
      before: '    // the subscription id and customer id.\n    await db.user.update({',
      after: '    // the subscription id and customer id.\n    void db.user.update({',
    },
    {
      id: 'T8-missing-user-metadata',
      title: 'User id read from the wrong metadata key',
      expected: 'loud',
      modeledOn: 'Checkout session created with `user_id` but the webhook reads `userId`; the update throws and Stripe retries',
      file: ROUTE,
      before: 'id: session?.metadata?.userId,',
      after: 'id: session?.metadata?.user_id,',
    },
    {
      id: 'T9-renamed-secret-env',
      title: 'Webhook secret read from a renamed env var',
      expected: 'loud',
      modeledOn: 'Env var renamed in code but not in the deployment: signature check fails with 400',
      file: ROUTE,
      before: 'env.STRIPE_WEBHOOK_SECRET',
      after: 'process.env.STRIPE_WEBHOOK_SIGNING_SECRET!',
    },
  ],
};
