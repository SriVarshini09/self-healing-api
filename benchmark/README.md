# SHAPI detection benchmark

Can SHAPI's outcome checks catch real Stripe webhook bugs? This benchmark runs
**real, unmodified open-source starter kits** against a real Postgres. It then
re-runs each kit with one realistic bug injected at a time.

## Method

1. **Pin the kit.** `pnpm fetch` checks out the kit at a pinned commit into
   `.kits/`. Kit code is never committed here, and its install scripts never run.
2. **Run the kit's real webhook route.** The harness calls the `POST` handler
   with Stripe events signed by Stripe's own library. Only `next/server`,
   `next/headers` and `next/navigation` are replaced, with minimal stubs.
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
pnpm --dir benchmark fetch
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

## The bug found in the unmodified kit

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
- **More kits.** One kit (`nextjs/saas-starter`) is covered so far. Kits whose
  handler calls the Stripe API, like `shadcn-ui/taxonomy`, need a Stripe API
  stub, which comes next.
