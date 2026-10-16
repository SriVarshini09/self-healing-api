# SHAPI detection benchmark

Can SHAPI's outcome checks catch real Stripe webhook bugs? This benchmark runs
**real, unmodified open-source starter kits** against a real Postgres. It then
re-runs each kit with one realistic bug injected at a time. Two kits so far:
Vercel's `nextjs/saas-starter` (Drizzle) and `shadcn-ui/taxonomy` (Prisma).

## Method

1. **Pin the kit.** `pnpm fetch-kits` checks out the kit at a pinned commit into
   `.kits/`. Kit code is never committed here, and its install scripts never run.
2. **Run the kit's real webhook route.** The harness calls the `POST` handler
   with Stripe events signed by Stripe's own library. Only `next/server`,
   `next/headers` and `next/navigation` are replaced, with minimal stubs. For
   kits whose handler calls back into the Stripe API (taxonomy fetches the
   subscription), an in-process fake of `api.stripe.com` answers from fixtures;
   nothing leaves the machine.
3. **Use a fresh database per variant.** Each run gets the kit's own migration
   SQL plus a few customer rows.
4. **Check outcomes with SHAPI's real code.** After delivery, SHAPI's
   outcome-check code (`packages/outcome-checks`) runs the checks a customer
   would configure. Example: "after `customer.subscription.updated`, the team has
   this subscription, product and status".
5. **Count detections.** A bug is detected when at least one check fails.
   Every check must pass on the unmodified kit, so false positives fail CI.

Run it locally (needs a Postgres role that can `CREATE DATABASE`):

```bash
pnpm install && pnpm --dir benchmark install --ignore-workspace
pnpm --dir benchmark fetch-kits
BENCH_DATABASE_URL=postgresql://user:pass@localhost:5432/postgres pnpm --dir benchmark bench
```

CI runs it on every push (job `benchmark`) and fails on any false positive or
detection regression.

## Results

## nextjs/saas-starter @ `6e33e58b1e55` (MIT (c) 2025 Vercel)

- Baseline (unmodified kit): all outcome checks pass (no false positives)
- Injected bugs: 10. Silent (every webhook still returned 2xx): 9.
- **Detected by outcome checks: 9/10** (silent ones: 8/9).

| Bug | Webhook responses | Outcome checks failed | Detected |
|---|---|---|---|
| M1-drop-updated-case: customer.subscription.updated no longer handled | 200 (silent) | subscription-applied, subscription-applied | yes |
| M2-wrong-id-field: Team looked up by subscription id instead of customer id | 200 (silent) | subscription-applied, subscription-applied, cancellation-applied | yes |
| M3-status-filter: Only 'trialing' treated as active | 200 (silent) | subscription-applied, subscription-applied | yes |
| M4-inverted-guard: Not-found guard inverted | 200 (silent) | subscription-applied, subscription-applied, cancellation-applied | yes |
| M5-copy-paste-null: Active branch writes a null subscription id | 200 (silent) | subscription-applied, subscription-applied | yes |
| M6-cancel-keeps-subscription: Cancel branch keeps the subscription id | 200 (silent) | cancellation-applied | yes |
| M7-drop-deleted-case: customer.subscription.deleted no longer handled | 200 (silent) | cancellation-applied | yes |
| M8-wrong-lookup-column: Lookup query filters the wrong column | 200 (silent) | subscription-applied, subscription-applied, cancellation-applied | yes |
| M9-unawaited-write: Database write not awaited | 200 (silent) | none | **no** |
| M10-renamed-secret-env: Webhook secret read from a renamed env var | 400 | subscription-applied, subscription-applied, cancellation-applied | yes |

### Found in the unmodified kit

- **plan-name-after-upgrade**: stripe_product_id moved to the new product but plan_name stayed "Base": the handler reads (plan.product as Stripe.Product).name, but webhook payloads carry plan.product as an id string, so the name is undefined and Drizzle skips the column

Why M9 is missed: the write still lands in a long-running process, so the
database ends up correct and an outcome check has nothing to see. On serverless
platforms the function can be frozen before the write completes. That is not
reproduced here, so we count it as a miss rather than claim it.

## shadcn-ui/taxonomy @ `298a8857c712` (MIT (c) 2023 shadcn)

A different shape from the first kit: on each event the handler calls Stripe
(`subscriptions.retrieve`) and then updates a Prisma `User` row.

**One disclosed change.** The kit targets MySQL (PlanetScale), and SHAPI's
outcome checks read Postgres. The harness switches the Prisma datasource line
from `mysql` to `postgresql` and generates the schema from the kit's own models.
The webhook handler, the Prisma models and `lib/db.ts` are untouched.

- Baseline (unmodified kit): all outcome checks pass (no false positives)
- Injected bugs: 9. Silent (every webhook still returned 2xx): 7.
- **Detected by outcome checks: 9/9** (silent ones: 7/7).

| Bug | Webhook responses | Outcome checks failed | Detected |
|---|---|---|---|
| T1-drop-checkout-case: checkout.session.completed no longer handled | 200 (silent) | subscription-recorded | yes |
| T2-drop-renewal-case: invoice.payment_succeeded no longer handled | 200 (silent) | renewal-recorded | yes |
| T3-wrong-subscription-id: Stores the checkout session id as the subscription id | 200 (silent) | subscription-recorded | yes |
| T4-null-customer: Customer id never saved | 200 (silent) | subscription-recorded | yes |
| T5-renewal-keeps-old-period: Renewal updates the price but not the period end | 200 (silent) | renewal-recorded | yes |
| T6-period-in-seconds: Period end stored as seconds treated as milliseconds | 200 (silent) | subscription-recorded | yes |
| T7-unawaited-write: Checkout write not awaited | 200 (silent) | subscription-recorded | yes |
| T8-missing-user-metadata: User id read from the wrong metadata key | 500 (checkout), 200 | subscription-recorded | yes |
| T9-renamed-secret-env: Webhook secret read from a renamed env var | 400 | subscription-recorded, renewal-recorded | yes |

T7 is detected here, unlike M9 in the first kit, for a reason specific to
Prisma: its queries are lazy, so a query that is never awaited never runs at
all. It is not a claim that SHAPI catches every timing bug.

### The issue in the unmodified kit: renewals break on newer Stripe accounts

From Stripe API version `2025-03-31.basil`, an invoice no longer has a top-level
`subscription` field; it moved to `parent.subscription_details.subscription`
([Stripe changelog](https://docs.stripe.com/changelog/basil/2025-03-31/adds-new-parent-field-to-invoicing-objects)).
Taxonomy's `invoice.payment_succeeded` handler reads `session.subscription`.
On an account using the newer version that value is `undefined`, so
`stripe.subscriptions.retrieve(undefined)` throws, the webhook returns 500, and
the renewal never reaches the user row. The check for that scenario fails on the
unmodified kit, which is the point: the harness reports it as a finding instead of
a false positive, and CI fails if it ever stops reproducing so this write-up
cannot go stale. The kit pins its own SDK to `2022-11-15`, which hides the
problem for the calls it makes itself but not for the webhook payload, whose
shape follows the account's version.

This is also the kind of change SHAPI's Stripe change monitor watches for: a
field disappearing from an event type.

## The bug found in the unmodified saas-starter kit

`lib/payments/stripe.ts` sets `planName: (plan?.product as Stripe.Product).name`.

- **Why it breaks:** Stripe webhook payloads are not expanded, so
  `plan.product` is an id string (`"prod_..."`). `.name` is therefore
  `undefined`, and Drizzle drops `undefined` columns from the update.
- **What happens:** after a plan change in the Stripe customer portal,
  `stripe_product_id` moves to the new product, but `plan_name` keeps the old
  plan.
- **Impact in the kit:** it only shows the wrong "Current Plan".
- **Impact in apps built on it:** apps that gate features on `planName` keep
  the old plan's access, for example keeping Pro after a downgrade.
- **Related report:** upstream issue
  [nextjs/saas-starter#294](https://github.com/nextjs/saas-starter/issues/294)
  covers the opposite shape (an *expanded* product writes `[object Object]` into
  `stripe_product_id`).
- **Status:** as of 2026-10-13 we found no upstream report of the unexpanded
  case.

## Not measured yet

- **Automated repair.** Scoring fixes needs an LLM API key. Today SHAPI's
  repair suggestions are hard-coded for its own demo app and would score 0 here.
  The plan is: give the repair agent the failing check, the event and the kit
  source; apply its patch; re-run this benchmark. A fix counts when every check
  passes again.
- **More kits.** Two kits are covered. Next candidates are kits on other ORMs
  and billing flows (for example Supabase-based starters, which need a stub for
  their REST layer).
