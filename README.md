# SHAPI — Behavioral Dependency Assurance (webhook reliability MVP)

**Thesis: a `200 OK` does not prove success.** SHAPI detects when a third-party
integration looks technically healthy but fails to produce the expected
**business outcome** (e.g. Stripe payment succeeds but the user is never provisioned).

Core abstraction: **behavioral invariants** — executable predicates over webhook
events, evaluated over time windows, with statistical **drift detection**,
**incidents**, **diagnosis**, **replay testing**, and a GitHub repair-PR workflow.
See [current product status](STATUS.md) for verified capabilities and remaining work.

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

In `NODE_ENV=production`, the backend refuses to start with a placeholder
`JWT_SECRET` or an incomplete GitHub App/token credential set. This is
intentional: a deployment should fail during rollout rather than appear
healthy while repair automation is misconfigured.

### Database backup and restore

The production Docker stack includes safe PowerShell runbooks. Backups are
plain SQL files written to the ignored `backups/` directory:

```powershell
./scripts/backup-db.ps1
```

Before a restore, take a fresh backup and review the target environment. The
restore command refuses to run unless the destructive action is explicit:

```powershell
./scripts/restore-db.ps1 -BackupFile ./backups/shapi-YYYYMMDD-HHMMSS.sql -ConfirmRestore
```

For a different compose file, project name, database name, or database role,
pass the matching `-EnvFile`, `-ComposeFile`, `-ProjectName`, `-Database`, and
`-Username` parameters. The scripts read `POSTGRES_USER` from the env file by
default and pass it explicitly to PostgreSQL.

### Deployment smoke check

After starting the production Compose stack, run the non-destructive smoke
check. It verifies API liveness, database readiness, dashboard serving, and
GitHub readiness without printing API keys or other secrets:

```powershell
./scripts/stack-smoke.ps1 -EnvFile ./path/to/.env -RequireGitHubApp
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

The `business-outcome` CI check also runs a target-application contract proof:
it applies a structured repair change to a provisioning source fixture, executes
the patched handler, and verifies that the same user becomes provisioned. This
is a bounded proof of the repair mechanism; it is not a substitute for running
the full test suite of every customer repository.

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
- `GET /alerts/status` reports the tenant-scoped durable alert outbox state
- `GET/PATCH /drift/config/:integrationId`, `GET /drift/results`, `POST /drift/check/:invariantId`, `GET /drift/summary`
- `POST /github/webhook`, GitHub status/installations, `POST /github/installations/sync`, `POST /github/incidents/:id/pr/preview`, incident PRs, PR verify
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
The live Docker stack also has a repeatable security smoke check:
`./scripts/security-smoke.ps1 -EnvFile .env`.

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
- Repair PRs require real App or token credentials and a persisted repair
  candidate with structured file changes. SHAPI reads the target files from the
  repository base branch, checks exact replacement preconditions, then commits
  the resulting content through Octokit. Candidates with only a suggested diff
  remain manual review items; a diff is never written as file content.
- To enable an automatic predicate repair, set both `repairRepository` (for
  example `owner/repo`) and `repairFilePath` (repository-relative path) on an
  invariant via `POST /invariants` or `PATCH /invariants/:id`. The mapped file
  must contain the current predicate text exactly once. Existing unmapped
  invariants continue to produce manual-review suggestions; SHAPI never
  guesses a repository file path.
- `POST /github/incidents/:id/pr/preview` performs no writes. It returns the
  repository base SHA, bounded source/result excerpts, and a short-lived
  signed approval token only after the candidate applies cleanly at that
  pinned revision. `POST /github/incidents/:id/pr` requires that token and
  independently verifies the target branch still resolves to the reviewed
  commit before it creates a PR.
- `POST /github/prs/:id/verify` returns the exact PR head SHA and each GitHub
  check run used as proof. A PR is not verified when checks are missing,
  running, or failing; the evidence is persisted and shown again when the
  dashboard reloads. Passing CI is evidence from the target repository, not a
  claim that SHAPI has proven the business outcome.
- Invariants may set `repairRequiredChecks` to the exact GitHub check names
  that represent the target application's tests. When configured, every named
  check must complete successfully in addition to generic CI before a repair
  becomes verified. The dashboard exposes this field beside the repository
  and file mapping.
- When `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and a real GitHub App
  installation are configured, PR creation and CI verification use a short-lived
  installation token. The explicit `GITHUB_TOKEN` mode remains available for
  local/operator deployments and synthetic token installations.
- If a GitHub App is unavailable, local/operator mode can use `GITHUB_TOKEN`
  together with `GITHUB_ACCOUNT_LOGIN` and an explicit comma-separated
  `GITHUB_REPOSITORIES` allow-list. This mode never infers repository access
  from the token alone and should not be used as a multi-tenant App substitute.
- The dashboard's GitHub readiness panel reports the active mode and provides the
  production setup checklist. For App mode, configure the App credentials, install
  the App on the target repository, grant Contents and Pull requests read/write
  permissions, set `GITHUB_WEBHOOK_SECRET_APP`, and point the App webhook to
  `/api/v1/github/webhook` on the public API URL. Reopen the dashboard's GitHub
  readiness panel to confirm it reports `app`.
- The backend runs a scheduled invariant-window evaluator (default every 60 seconds;
  configure with `INVARIANT_EVALUATION_INTERVAL_SEC`) and uses weighted baseline/current
  trial counts for drift calculations.
- Invariant creation is capped at 100 per tenant by default; set
  `SHAPI_MAX_INVARIANTS_PER_TENANT` to change the cap. The count and insert are
  serialized per tenant in PostgreSQL, and predicate expressions are limited to
  4096 characters. Once at the cap, creating another invariant returns 409.
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
- Optional incident alerts use `ALERT_WEBHOOK_URL` and
  `ALERT_WEBHOOK_SECRET`. New drift incidents enter a durable outbox; the
  scheduler sends signed `incident.detected` JSON with HMAC-SHA256 in
  `x-shapi-alert-signature`, retries transient failures with bounded backoff,
  and reports pending/retry/delivered/failed counts through `/alerts/status`.
  Leave the URL empty to disable delivery. Production rejects a URL without
  its signing secret, and receivers must verify the signature against the
  exact request body.
- Unit tests, typechecks, backend lint, and the dashboard production build are
  run in CI/local verification. Live Postgres E2E requires Docker or a configured
  external database and is intentionally not claimed by the repository docs.

## Incident lifecycle

`DETECTED → TRIAGED (diagnosis + repair candidates) → REPLAYING (replay verification) → REPAIRED (PR) → RESOLVED (CI merge)`, with `DISMISSED` as escape hatch.

Diagnosis runs once per newly detected incident; repeating it returns 409 rather
than creating duplicate candidates. Replay requires a triaged or replaying
incident. Neither action can reopen resolved or dismissed incidents.

## Production checklist (manual, requires real secrets)

- Stripe: set a real `STRIPE_WEBHOOK_SECRET` (`whsec_...`) in `.env` and point
  Stripe CLI at `POST /api/v1/webhooks/stripe` for a true signature check.
  Without it, `test`-signature traffic uses test mode (local simulate only).
- GitHub: set `GITHUB_TOKEN` (or configure a GitHub App installation) and
  select a candidate with applicable structured file changes to create a real
  repair PR. The API rejects PR creation without credentials or a valid patch;
  suggested-only diffs require manual review.
- GitHub App webhooks: set `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`,
  `GITHUB_APP_SLUG` (the slug in the App's public URL),
  `GITHUB_WEBHOOK_SECRET_APP` and, when more than one GitHub integration exists,
  set `GITHUB_APP_INTEGRATION_ID` so installation and PR events cannot be
  assigned across tenants. Install the App on the target repository and grant
  Contents read/write, Pull requests read/write, Checks read-only, and Metadata
  read-only permissions.
- Alerts: set `ALERT_WEBHOOK_URL` and a strong `ALERT_WEBHOOK_SECRET`, then
  verify the receiver accepts the signed `incident.detected` payload and
  confirm `/api/v1/alerts/status` moves deliveries to `delivered`.
- Multi-tenant predicates: tune the per-tenant quota for deployment size and
  monitor `isolated-vm` resource use under real traffic.
- Auth: rotate `SHAPI_API_KEY` per environment; set `VITE_SHAPI_API_KEY` to match.
- Bootstrap: set a random `SHAPI_BOOTSTRAP_TOKEN` of at least 32 characters only
  during tenant onboarding, then remove or rotate it.
