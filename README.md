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
`/ready` for orchestration, and listens on container port 3001. The dashboard is
served by Nginx on container port 80 and is published on port 8080 by Compose;
it receives its API configuration at container startup. The images also honor
the runtime `PORT` contract used by hosted Docker providers. The Render
Blueprint sets both web services to port 10000 and wires the dashboard's
`/api/` proxy to the API service's private `hostport` automatically. For
multi-replica deployments, run migrations as a separate release job before
starting application replicas.

The non-destructive `scripts/stack-smoke.ps1` check retries API, database, and
dashboard endpoints during bounded startup settling, so a release check does
not fail on the first connection while a restarted container is becoming
healthy. Adjust `-StartupTimeoutSec` and `-RetryDelaySec` when a provider has a
slower startup profile.

Before starting the stack, validate the dotenv file syntax without printing
any values. This catches a pasted private-key/base64 line that is missing its
variable name and reports only the line number:

```powershell
./scripts/validate-env.ps1 -EnvFile ./path/to/.env
```

### Render Blueprint

`render.yaml` provides a hosted option with one Docker API service, one Docker
dashboard service, and managed PostgreSQL. It is intentionally committed
without credentials. Apply it from the Render Dashboard, then set the
`sync: false` values before deploying:

1. Apply the Blueprint from the repository. The dashboard uses a same-origin
   `/api/v1` proxy and the API automatically receives the dashboard's public
   Render URL, so no service URL copying is required.
2. Set a real `DEMO_SAAS_URL` (or an allowed placeholder if the demo is not
   hosted), `SHAPI_BOOTSTRAP_TOKEN`, and the GitHub App values. Prefer a
   base64-encoded private key in `GITHUB_APP_PRIVATE_KEY_B64` so the PEM never
   needs to be pasted into a multiline environment value.
3. Deploy the services, call `POST /api/v1/bootstrap/tenant` once with the
   bootstrap token, and store the returned owner API key. Use that key as
   `VITE_SHAPI_API_KEY` or configure OIDC before exposing the dashboard.
4. Point the GitHub App webhook at `https://<api-host>/api/v1/github/webhook`,
   then run the remote readiness checks from a trusted operator environment.

Both Render web services use `autoDeployTrigger: checksPass`, so a connected
Render workspace will wait for the repository's required GitHub checks before
deploying a new commit.

The Blueprint is deployment-ready but cannot be considered hosted until a
Render workspace applies it, secrets are entered, and the public URLs and
GitHub delivery are verified.

After the hosted services are live, run the public-only gate from a trusted
operator machine. It refuses localhost or non-HTTPS URLs and does not mutate
the hosted database:

```powershell
./scripts/hosted-readiness.ps1 `
  -ApiUrl https://<api-host> `
  -DashboardUrl https://<dashboard-host> `
  -EnvFile ./hosted-operator.env `
  -IncludeCapacitySmoke -DurationSeconds 60 -CapacityConcurrency 1 `
  -CapacityDelayMs 250 -MaxErrorRate 0
```

The operator env file must contain only the hosted `SHAPI_API_KEY`; keep it
outside the repository. The gate checks API/database readiness, security
headers and 401 behavior, authenticated load, GitHub App mode, the dashboard's
live command center, and optional paced capacity. It also prints the
read-only repair-readiness audit by default, including manual-review and
missing-check states. Add `-RequireRepairTargets` when a hosted release must
fail unless every invariant has a reviewed repository target and exact
required checks.

To create the first hosted tenant without putting the bootstrap token in shell
history, store `SHAPI_BOOTSTRAP_TOKEN` in a separate operator env file and run:

```powershell
./scripts/bootstrap-hosted-tenant.ps1 `
  -ApiUrl https://<api-host> `
  -EnvFile ./hosted-bootstrap.env `
  -TenantName "Production" `
  -Slug production
```

The script makes no file changes and prints the owner API key once. Copy it
into the dashboard's secret configuration immediately, then remove the
temporary operator env file from the machine.

For a repeatable single-host deployment, use the guarded deployment command. It
validates the rendered Compose configuration, starts the services, waits for
`/ready` and the dashboard, then runs the production readiness gate:

```powershell
./scripts/deploy-production.ps1 -EnvFile ./path/to/.env -RequireGitHubApp
```

Use `-NoBuild` when the image has already been built. Add
`-IncludeBackupRestoreDrill -ConfirmDrill` only when the temporary-database
restore verification is intentionally part of the release check. The command
accepts `-IncludeDashboardSmoke` and the opt-in capacity parameters
(`-IncludeCapacitySmoke -DurationSeconds 60 -CapacityConcurrency 1
-CapacityDelayMs 100 -MaxErrorRate 0`) so the complete local release gate can
run from one command. It does not roll back automatically; if readiness fails
it prints service status and the last 100 backend log lines for operator
diagnosis.

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

The production Compose services restart after an unexpected container exit and
allow a bounded graceful shutdown. The API drains in-flight HTTP requests,
stops its evaluator, and disconnects Prisma when Docker sends `SIGTERM`; keep
the `stop_grace_period` values intact when running the stack under an
orchestrator.

For a different compose file, project name, database name, or database role,
pass the matching `-EnvFile`, `-ComposeFile`, `-ProjectName`, `-Database`, and
`-Username` parameters. The scripts read `POSTGRES_USER` from the env file by
default and pass it explicitly to PostgreSQL.

To verify the full backup/restore path without touching the live database, run
the confirmation-gated drill. It creates a temporary database, restores the
backup, compares representative row counts, and removes both temporary assets:

```powershell
./scripts/backup-restore-drill.ps1 -EnvFile ./path/to/.env -ConfirmDrill
```

### Deployment smoke check

After starting the production Compose stack, run the non-destructive smoke
check. It verifies API liveness, database readiness, dashboard serving, and
GitHub readiness without printing API keys or other secrets:

```powershell
./scripts/stack-smoke.ps1 -EnvFile ./path/to/.env -RequireGitHubApp
```

For a single release gate, run the combined readiness check. It runs the stack,
security, and authenticated load smoke tests. Add
`-IncludeBackupRestoreDrill -ConfirmDrill` when you also want the
temporary-database backup/restore drill:

```powershell
./scripts/production-readiness.ps1 -EnvFile ./path/to/.env -RequireGitHubApp
./scripts/production-readiness.ps1 -EnvFile ./path/to/.env -RequireGitHubApp -IncludeBackupRestoreDrill -ConfirmDrill
```

The load check is intentionally bounded and defaults to 100 authenticated
requests at concurrency 20. Increase `-Requests` and `-Concurrency` only as a
deliberate capacity test; this readiness gate is not a substitute for sustained
load testing in the hosting environment.

For a sustained local or staging capacity check, enable the duration-based
smoke test. It keeps authenticated requests in flight for the requested period
and fails if the observed error rate exceeds the limit:

```powershell
./scripts/production-readiness.ps1 -EnvFile ./path/to/.env -RequireGitHubApp -IncludeCapacitySmoke -DurationSeconds 60 -CapacityConcurrency 1 -CapacityDelayMs 100 -MaxErrorRate 0
```

The delay is useful when the authenticated endpoint's API rate limit is lower
than the desired concurrency. Run sustained tests against a staging/hosted
environment before using larger durations or concurrency; the check is
intentionally opt-in for release gates.

The production dashboard can also be checked against the running Docker stack
without changing state:

```powershell
./scripts/production-readiness.ps1 -EnvFile ./path/to/.env -RequireGitHubApp -IncludeDashboardSmoke
```

This browser smoke verifies the live command center, telemetry connection, alert
delivery status, repair-target panel, and diagnosis modal. It does not create
incidents, replay jobs, or pull requests.

Include the read-only repair target audit in the same gate when reviewing a
release or hosted tenant:

```powershell
./scripts/production-readiness.ps1 -EnvFile ./path/to/.env -RequireGitHubApp -IncludeRepairAudit
```

Add `-RequireRepairTargets` when every invariant must have a reviewed target
and at least one exact required GitHub check. Existing unmapped invariants are
expected to fail that stricter mode until their target behavior is reviewed.

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

# HTTP-level business-outcome proof (failure stays 200, recovery provisions)
pnpm --filter @shapi/demo-saas e2e
```

Then in the dashboard: **incidents → select incident → Diagnose + suggest repairs**,
inspect the timeline, replay results, and repair candidates.

The `business-outcome` CI check runs the demo's HTTP-level checkout/webhook
flow, a target-application contract fixture, and a reviewed adapter against the
real `apps/demo-saas/src/business-outcome.ts` source. The HTTP proof shows that
an intentionally broken webhook can return 200 while leaving the user
unprovisioned, then verifies recovery with the same application flow. The
adapter proof applies a structured repair change, executes the patched handler,
and verifies that the same user becomes provisioned. This is still a bounded
proof of the repair mechanism, not a substitute for running the full test suite
of every customer repository.
The reusable `proveBusinessOutcomeRepair` contract requires each target adapter
to provide its source loader, isolated state factory, event runner, and explicit
failure/recovery predicates; it fails closed when the baseline does not reproduce
the expected failure or the patched source does not recover.

Automatic repository repairs must also declare at least one exact required
GitHub check for the mapped target. Preview and PR creation fail closed without
that check, so an unrelated green workflow cannot be treated as repair proof.

## Auth

All `/api/v1` routes except third-party webhook receivers require `x-api-key`
(hashed + expiry-checked against the `APIKey` table). Local dev key lives in
`.env` as `SHAPI_API_KEY` and is seeded by `pnpm db:seed` — generate a fresh one
per real environment. Tenant operators can create, list, and revoke scoped keys
through `/api/v1/api-keys`; the raw key is returned only at creation time. New
deployments can use `POST /api/v1/bootstrap/tenant` with the separate
`SHAPI_BOOTSTRAP_TOKEN` to create the first tenant and key.
The production Compose file passes this token through only when explicitly
provided; set it during onboarding, verify the returned owner key, then remove
or rotate the token and recreate the backend container.

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
For a bounded authenticated load baseline, run:
`node scripts/load-smoke.mjs --env-file .env --requests 100 --concurrency 20`.

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
- For this repository's local demo tenant, the reviewed Stripe predicate
  targets can be checked and configured repeatably with
  `./scripts/configure-demo-repair-targets.ps1 -EnvFile ./path/to/.env -Apply`.
  Add `-IncludeProvisioningAdapter` to also map the reviewed provisioning
  business-outcome patch to `apps/demo-saas/src/business-outcome.ts`; that
  target requires both the generic `verify` check and the dedicated
  `business-outcome` check before it can be considered verified. Customer
  repositories still need their own reviewed adapter and test command.

Before opening repair PRs, audit the authenticated tenant without changing any
invariant configuration:

```powershell
./scripts/audit-repair-readiness.ps1 `
  -ApiUrl http://localhost:3001 `
  -EnvFile ./path/to/.env
```

The audit marks unmapped invariants as `MANUAL_REVIEW`, mapped invariants with
no exact required GitHub check as `BLOCKED_NO_REQUIRED_CHECKS`, and only marks
targets with both an explicit repository/file mapping and at least one required
check as `READY_FOR_TARGET_REVIEW`. The reviewed demo provisioning adapter is
additionally blocked unless it includes the exact `business-outcome` check. Add
`-FailOnUnready` in a release checklist when every invariant in a tenant must be
mapped before automatic repair review.
Use `-Json` for CI or onboarding tooling.

The incident endpoints expose the same decision directly on each persisted
repair candidate: `reviewStatus` is `PR_READY_AFTER_REVIEW` only when the
candidate has an explicit repository mapping, structured file changes, and at
least one configured required GitHub check. `automationEligible` is false for
`MANUAL_REVIEW` candidates, and `reviewReason` explains which prerequisite is
missing. These fields are included in incident list/detail/update responses,
diagnosis responses, and repair-candidate timeline events so clients cannot
mistake a suggestion-only diff for an automatable repair.
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
- When `GITHUB_APP_ID`, one GitHub App private-key source, and a real GitHub App
  installation are configured, PR creation and CI verification use a short-lived
  installation token. The key may be supplied directly with
  `GITHUB_APP_PRIVATE_KEY`, from a mounted secret file with
  `GITHUB_APP_PRIVATE_KEY_FILE`, or as one-line base64 with
  `GITHUB_APP_PRIVATE_KEY_B64`; configure only one source. The file/base64 forms
  avoid multiline PEM corruption in Windows `.env` files and hosted secret
  managers. On Windows, a base64 value can be generated without putting the PEM
  on the command line with:

  ```powershell
  [Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\secrets\github-app.pem'))
  ```

  The explicit `GITHUB_TOKEN` mode remains available for
  local/operator deployments and synthetic token installations.
- The dashboard readiness status and the repair preview/PR routes resolve the
  same direct, file, or base64 key source, so a hosted deployment using
  `GITHUB_APP_PRIVATE_KEY_B64` is authorized consistently end to end.
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
- GitHub webhook deliveries are persisted with their `X-GitHub-Delivery` id.
  Retries return the original event id with `duplicate: true` and do not repeat
  lifecycle processing. Completed and failed processing states remain available
  in the webhook-event audit trail. Push events are recorded but do not mutate
  repair state because only workflow-run and pull-request events identify the
  authoritative repair lifecycle.
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
  `/metrics` exposes Prometheus-compatible request counters. In production,
  set `METRICS_TOKEN` in the secret manager and send it as `x-metrics-token`
  or `Authorization: Bearer ...`; without the token the endpoint intentionally
  returns 404. Local development keeps metrics open for convenience.
- Optional incident alerts use `ALERT_WEBHOOK_URL` and
  `ALERT_WEBHOOK_SECRET`. New drift incidents enter a durable outbox; the
  scheduler sends signed `incident.detected` JSON with HMAC-SHA256 in
  `x-shapi-alert-signature`, retries transient failures with bounded backoff,
  and reports pending/processing/retry/delivered/failed counts through
  `/alerts/status`. A delivery claimed as `PROCESSING` is leased for five
  minutes; if a process crashes, the scheduler requeues it (or marks it failed
  after the attempt limit), so rows cannot remain stuck forever. Leave the URL
  empty to disable delivery. Production rejects a URL without its signing
  secret, and receivers must verify the signature against the exact request
  body.
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
- GitHub App webhooks: set `GITHUB_APP_ID`, exactly one private-key source
  (`GITHUB_APP_PRIVATE_KEY_B64`, `GITHUB_APP_PRIVATE_KEY_FILE`, or
  `GITHUB_APP_PRIVATE_KEY`), and `GITHUB_APP_SLUG` (the slug in the App's public URL),
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
