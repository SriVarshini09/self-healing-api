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

# 4. database (db:push is convenient for a brand-new local demo)
pnpm db:generate
pnpm db:push
pnpm db:seed

# 5. run everything (backend :3001, dashboard :5173, demo-saas :3000)
pnpm dev
```

## Production containers

The repository includes provider-neutral Docker packaging. Copy `.env.example`
to `.env`, replace development secrets, set `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `POSTGRES_DB`, `VITE_API_URL`, and `VITE_SHAPI_API_KEY`,
set `SHAPI_DASHBOARD_URL` to the dashboard's public URL, then run:

```powershell
docker compose -f docker-compose.production.yml up --build
```

The backend applies checked-in Prisma migrations before starting, exposes
`/ready` for orchestration, and listens on port 3001. The dashboard is served
by Nginx on port 8080 and receives its API configuration at container startup.
For multi-replica deployments, run migrations as a separate release job before
starting application replicas.

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
per real environment. Tenant operators can create, list, and revoke scoped keys
through `/api/v1/api-keys`; the raw key is returned only at creation time. New
deployments can use `POST /api/v1/bootstrap/tenant` with the separate
`SHAPI_BOOTSTRAP_TOKEN` to create the first tenant and key.

API keys carry a tenant role: `OWNER`, `ADMIN`, `OPERATOR`, or `VIEWER`. Only
Owner/Admin keys can administer keys, and only the Owner can assign Owner/Admin
roles. Permissions still provide endpoint-level `read`/`write`/`*` scope.

Requests are rate-limited per API key using a hashed bucket, so tenants do not
share an IP-based quota. Requests without an API key fall back to an IP bucket.
Configure the window with `API_RATE_LIMIT_MAX` and `API_RATE_LIMIT_WINDOW`.

The dashboard also supports provider-neutral OIDC login. Configure
`OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`,
`OIDC_REDIRECT_URI`, and `OIDC_DEFAULT_TENANT_SLUG`; the same flow works with
Google Workspace, Auth0, Okta, and other standards-compliant providers. The
first OIDC user for a tenant becomes Owner; subsequent users start as Operators.
OIDC users use seven-day hashed server sessions in HttpOnly cookies.
For an OIDC-only dashboard deployment, leave `VITE_SHAPI_API_KEY` empty; the
production compose file supports this mode and the dashboard will use the
browser session instead.

## API surface (all under `/api/v1`)

- `POST /webhooks/stripe|github|sendgrid|twilio`, `POST /webhooks/:integrationId`
- `GET/POST /integrations`, `GET/PATCH/DELETE /integrations/:id`, webhook-events, webhook-url
- `GET/POST /invariants`, `GET/PATCH/DELETE /invariants/:id`, `POST /invariants/:id/evaluate`, `GET /invariants/:id/evaluations`
- `GET /incidents`, `GET/PATCH /incidents/:id`, `GET /incidents/:id/timeline`, `POST /incidents/:id/diagnose`, `POST /incidents/:id/replay`
- `GET/PATCH /drift/config/:integrationId`, `GET /drift/results`, `POST /drift/check/:invariantId`, `GET /drift/summary`
- `POST /github/webhook`, installations, incident PRs, PR verify
- `POST /sdk/track`, `GET /sdk/events`
- `GET/POST /api-keys`, `DELETE /api-keys/:id`, `POST /bootstrap/tenant`

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

- Invariant predicates execute as **plain JavaScript** inside an `isolated-vm`
  V8 isolate (minimal `event` global, 32 MB memory cap, deep-cloned input,
  100ms timeout) shared via `@shapi/invariant-engine`. Do **not** use TypeScript
  syntax (`as any`) in predicates — validators reject it. The native dependency
  is optional so local Windows development can fall back to `node:vm`; production
  fails closed if `isolated-vm` cannot load.
- Stripe webhooks are verified with the real `stripe.webhooks.constructEvent` SDK
  against the integration's secret, using raw-body capture (`fastify-raw-body`,
  route opt-in). Local `test`-signature traffic and the dev placeholder secret fall
  back to test mode so simulate scripts work without Stripe keys.
- SendGrid signed webhooks use the provider's ECDSA signature and raw-body headers;
  store the SendGrid public key in integration config as `sendgridPublicKey`.
- Twilio webhooks use `X-Twilio-Signature` HMAC verification over the configured
  public webhook URL and sorted request parameters.
- Repair PRs use real Octokit (`openRepairPr`: branch from main → commit files →
  open PR) whenever `GITHUB_TOKEN` is set, and a simulated PR otherwise.
- If a GitHub App is unavailable, local/operator mode can use `GITHUB_TOKEN`
  together with `GITHUB_ACCOUNT_LOGIN` and an explicit comma-separated
  `GITHUB_REPOSITORIES` allow-list. This mode never infers repository access
  from the token alone and should not be used as a multi-tenant App substitute.
- The backend runs a scheduled invariant-window evaluator (default every 60 seconds;
  configure with `INVARIANT_EVALUATION_INTERVAL_SEC`) and uses weighted baseline/current
  trial counts for drift calculations.
- `POST /sdk/track` feeds the same invariant engine as webhooks (shared
  `evaluateInvariantsForEvent`). A tracked `provisioning.failed` flips the
  `No Failed Provisioning Invariant` to VIOLATED and opens a deduped HIGH
  incident — so a 200-OK failure becomes a triageable incident with zero manual
  steps. VIOLATED invariants stay in the evaluation set, so recovery back to
  HEALTHY and re-offense after resolve both work.
- Production deployments should use `pnpm db:migrate:deploy`, which applies the
  checked-in baseline and production-hardening migrations. Existing databases
  created with the old `db push` workflow should be reviewed against the
  baseline and run `pnpm --filter @shapi/backend exec prisma migrate resolve
  --applied 20260929000000_baseline` once; then deploy the hardening migration
  so existing rows receive the local tenant.
- Prisma models `GitHubInstallation` / `GitHubPullRequest` map to client
  `prisma.gitHubInstallation` / `prisma.gitHubPullRequest` (capital H) — code uses `(prisma as any)` accordingly.
- `DATABASE_URL` uses the `postgresql://` scheme; backend loads repo-root `.env` via `dotenv`.
- `/health` is a liveness check, `/ready` verifies database connectivity, and
  `/metrics` exposes Prometheus-compatible request counters.
- Unit tests, typechecks, backend lint, and the dashboard production build are
  run in CI/local verification. Live Postgres E2E requires Docker or a configured
  external database and is intentionally not claimed by the repository docs.

## Incident lifecycle

`DETECTED → TRIAGED (diagnosis + repair candidates) → REPLAYING (replay verification) → REPAIRED (PR) → RESOLVED (CI merge)`, with `DISMISSED` as escape hatch.

## Production checklist (manual, requires real secrets)

- Stripe: set a real `STRIPE_WEBHOOK_SECRET` (`whsec_...`) in `.env` and point
  Stripe CLI at `POST /api/v1/webhooks/stripe` for a true signature check.
  Without it, `test`-signature traffic uses test mode (local simulate only).
- GitHub: set `GITHUB_TOKEN` and create a repair PR against a real repo to
  exercise the Octokit path (`openRepairPr`). Without it, PRs are simulated.
- GitHub App webhooks: set `GITHUB_WEBHOOK_SECRET_APP` and, when more than one
  GitHub integration exists, set `GITHUB_APP_INTEGRATION_ID` so installation and
  PR events cannot be assigned across tenants.
- Multi-tenant predicates: add per-tenant predicate quotas and isolate recycling
  around the existing `isolated-vm` runtime.
- Auth: rotate `SHAPI_API_KEY` per environment; set `VITE_SHAPI_API_KEY` to match.
- Bootstrap: set a random `SHAPI_BOOTSTRAP_TOKEN` of at least 32 characters only
  during tenant onboarding, then remove or rotate it.
