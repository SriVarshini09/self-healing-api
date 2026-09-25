# SHAPI — Behavioral Dependency Assurance (webhook reliability MVP)

**Thesis: a `200 OK` does not prove success.** SHAPI detects when a third-party
integration looks technically healthy but fails to produce the expected
**business outcome** (e.g. Stripe payment succeeds but the user is never provisioned).

Core abstraction: **behavioral invariants** — executable predicates over webhook
events, evaluated over time windows, with statistical **drift detection**,
**incidents**, **diagnosis**, **replay-verified repairs**, and a **verified PR workflow**.

## Monorepo layout

```
apps/
  backend/    Fastify + Prisma + PostgreSQL API (webhooks, invariants, incidents, drift, SDK ingest, GitHub)
  dashboard/  React + Vite monitoring UI (:5173)
  demo-saas/  Demo SaaS with Stripe webhook receiver + simulated silent-provisioning bug (:3000)
packages/
  shared/               Zod domain types
  invariant-engine/     Predicate validation + evaluation + window health (tested)
  drift-detection/      Two-proportion z-test + effect size (tested)
  sdk/                  Framework-agnostic instrumentation client (tested)
  diagnosis-engine/     Pure root-cause heuristics (tested)
  replay-engine/        Fix-candidate replay verification (tested)
  repair-generation/    Repair suggestions (tested)
  github-integration/   Webhook verification + verified-PR helpers (tested)
```

## Prerequisites

- Node >= 20, pnpm >= 9
- Docker (for PostgreSQL + Redis) **or** a local PostgreSQL you point `DATABASE_URL` at

## Quickstart (local)

```powershell
# 1. install
pnpm install

# 2. start postgres + redis (requires Docker Desktop running)
docker compose up -d

# 3. env
Copy-Item .env.example .env   # or edit .env (already has dev defaults)

# 4. database
pnpm db:generate
pnpm db:push
pnpm db:seed

# 5. run everything (backend :3001, dashboard :5173, demo-saas :3000)
pnpm dev
```

Open:

- API docs: http://localhost:3001/docs
- Dashboard: http://localhost:5173
- Demo SaaS health: http://localhost:3000/health

## The demo: 200 OK that fails the business

```powershell
# happy path: payment -> provisioning.completed
pnpm --filter @shapi/demo-saas simulate:success

# the bug: webhook returns 200 OK but provisioning silently fails.
# SHAPI invariant flips to VIOLATED, drift fires, incident opens.
pnpm --filter @shapi/demo-saas simulate:failure

# 60 failing webhooks to trigger statistical drift detection
pnpm --filter @shapi/demo-saas simulate:drift
```

Then in the dashboard: **incidents → select incident → Diagnose + suggest repairs**,
inspect the timeline, replay results, and repair candidates.

## Auth

All `/api/v1` routes except third-party webhook receivers require `x-api-key`
(hashed + expiry-checked against the `APIKey` table). Local dev key lives in
`.env` as `SHAPI_API_KEY` and is seeded by `pnpm db:seed` — generate a fresh one
per real environment. The dashboard sends `VITE_SHAPI_API_KEY` (same dev default
baked in); the SDK sends its configured key.

## API surface (all under `/api/v1`)

- `POST /webhooks/stripe|github|sendgrid|twilio`, `POST /webhooks/:integrationId`
- `GET/POST /integrations`, `GET/PATCH/DELETE /integrations/:id`, webhook-events, webhook-url
- `GET/POST /invariants`, `GET/PATCH/DELETE /invariants/:id`, `POST /invariants/:id/evaluate`, `GET /invariants/:id/evaluations`
- `GET /incidents`, `GET/PATCH /incidents/:id`, `GET /incidents/:id/timeline`, `POST /incidents/:id/diagnose`, `POST /incidents/:id/replay`
- `GET/PATCH /drift/config/:integrationId`, `GET /drift/results`, `POST /drift/check/:invariantId`, `GET /drift/summary`
- `POST /github/webhook`, installations, incident PRs, PR verify
- `POST /sdk/track`, `GET /sdk/events`

## Tests (all must pass before marking anything complete)

```powershell
pnpm --filter @shapi/invariant-engine test
pnpm --filter @shapi/drift-detection test
pnpm --filter @shapi/sdk test
pnpm --filter @shapi/diagnosis-engine test
pnpm --filter @shapi/replay-engine test
pnpm --filter @shapi/repair-generation test
pnpm --filter @shapi/github-integration test
pnpm --filter @shapi/backend exec vitest run src/routes/__tests__/webhooks.test.ts
pnpm --filter @shapi/demo-saas test
```

Typechecks: `pnpm -r typecheck`. Builds verified: backend `tsc`, dashboard `tsc -b && vite build`, demo-saas `tsc`.

## Important implementation notes

- Invariant predicates execute as **plain JavaScript** inside a `node:vm` sandbox
  (minimal `event` global, deep-cloned input, 100ms timeout) shared via
  `@shapi/invariant-engine`. Do **not** use TypeScript syntax (`as any`) in
  predicates — validators reject it. For untrusted multi-tenant input, upgrade to
  `isolated-vm`.
- Stripe webhooks are verified with the real `stripe.webhooks.constructEvent` SDK
  against the integration's secret, using raw-body capture (`fastify-raw-body`,
  route opt-in). Local `test`-signature traffic and the dev placeholder secret fall
  back to test mode so simulate scripts work without Stripe keys.
- Repair PRs use real Octokit (`openRepairPr`: branch from main → commit files →
  open PR) whenever `GITHUB_TOKEN` is set, and a simulated PR otherwise.
- `POST /sdk/track` feeds the same invariant engine as webhooks (shared
  `evaluateInvariantsForEvent`). A tracked `provisioning.failed` flips the
  `No Failed Provisioning Invariant` to VIOLATED and opens a deduped HIGH
  incident — so a 200-OK failure becomes a triageable incident with zero manual
  steps. VIOLATED invariants stay in the evaluation set, so recovery back to
  HEALTHY and re-offense after resolve both work.
- Prisma models `GitHubInstallation` / `GitHubPullRequest` map to client
  `prisma.gitHubInstallation` / `prisma.gitHubPullRequest` (capital H) — code uses `(prisma as any)` accordingly.
- `DATABASE_URL` uses the `postgresql://` scheme; backend loads repo-root `.env` via `dotenv`.
- Live-verified 2026-09-18 against local Postgres: `scripts/e2e.ts` (webhook→DB),
  `scripts/e2e-incident.ts` (drift→incident→diagnose→replay), and demo-saas
  `scripts/e2e.ts` (200-OK-despite-failure) all pass. Total: 21 unit tests green
  plus 3 live E2E scripts green.

## Incident lifecycle

`DETECTED → TRIAGED (diagnosis + repair candidates) → REPLAYING (replay verification) → REPAIRED (PR) → RESOLVED (CI merge)`, with `DISMISSED` as escape hatch.

## Production checklist (manual, requires real secrets)

- Stripe: set a real `STRIPE_WEBHOOK_SECRET` (`whsec_...`) in `.env` and point
  Stripe CLI at `POST /api/v1/webhooks/stripe` for a true signature check.
  Without it, `test`-signature traffic uses test mode (local simulate only).
- GitHub: set `GITHUB_TOKEN` and create a repair PR against a real repo to
  exercise the Octokit path (`openRepairPr`). Without it, PRs are simulated.
- Multi-tenant predicates: upgrade the `node:vm` sandbox to `isolated-vm`
  before accepting untrusted predicate code.
- Auth: rotate `SHAPI_API_KEY` per environment; set `VITE_SHAPI_API_KEY` to match.
