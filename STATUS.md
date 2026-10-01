# SHAPI product status

Updated 2026-10-01. This is a current-state checklist, not a claim that the
product is production-ready. See [README.md](README.md) for setup and API details.

## Verified in this repository

- The local production Docker stack runs PostgreSQL, the backend, and the
  dashboard. On 2026-10-01, the backend was rebuilt from `master` at
  `201a970`; `/health`, `/ready`, and the dashboard returned 200.
- GitHub Actions CI on `master` passed for the current head `201a970`:
  [run 36930445720](https://github.com/SriVarshini09/self-healing-api/actions/runs/36930445720).
  CI checks workspace types, backend lint, package/backend unit tests, backend
  and dashboard builds, and Prisma schema validation.
- Webhook and SDK events feed behavioral invariants; drift detection and
  incident creation are implemented. Tenant-scoped API keys and invariant
  quotas are enforced.
- A controlled live API check confirmed the core business-outcome flow:
  `provisioning.failed` → `DETECTED` incident → `TRIAGED` diagnosis with repair
  candidates. The backend E2E script now asserts this flow instead of checking
  only HTTP status codes.
- Diagnosis persists repair candidates once per newly detected incident.
  Replay and PR actions cannot reopen resolved or dismissed incidents.
- Real GitHub repair PR creation is implemented for a persisted candidate with
  structured file changes. It reads the target repository at a pinned base
  commit, checks exact edit preconditions, and writes resulting file contents.
  Human-readable diffs are never committed as file contents. PR verification
  checks GitHub CI and merge state separately.
- On 2026-10-01, the real GitHub App path opened PR #4 against
  `SriVarshini09/self-healing-api` from a mapped repair candidate. The required
  `verify` check passed, and the API returned `verified: true` with the exact
  head SHA and check-run evidence. The PR remains open for human review.
- The dashboard now exposes the live GitHub App connection and installation
  state, and the incident view supports a pinned source preview, explicit
  operator approval, real repair-PR creation, and verification from one flow.
- Invariant settings now let operators create or edit the repository/file
  repair mapping and required GitHub check names without using the API.
- Incident PRs now display persisted verification evidence after reload,
  including the exact verified head SHA and individual check conclusions.
- On 2026-10-01, the live Docker stack completed a read-only dashboard preview
  against the real installation and returned the current `master` SHA, one
  changed file, and a signed preview approval token without creating a PR.
- The demo SaaS now has a dedicated business-outcome regression check proving
  that the simulated provisioning failure leaves the user unprovisioned and
  that the corrected handler recovers the same user. GitHub Actions runs this
  as a separate `business-outcome` check.
- The `business-outcome` check now also applies a structured repair change to a
  target-app provisioning source fixture, executes the patched handler, and
  proves the same user becomes provisioned. It fails closed when the reviewed
  source precondition has drifted.
- Production startup now fails closed when placeholder JWT secrets or partial
  GitHub App/token credentials are supplied, preventing an unsafe deployment
  from appearing healthy.
- GitHub App private keys can now be supplied directly, from a mounted secret
  file, or as one-line base64; startup validation requires exactly one source,
  which avoids multiline `.env` corruption in Windows and hosted secret stores.
- The Docker deployment now includes explicit PowerShell backup and
  confirmation-gated restore runbooks for PostgreSQL, with backup artifacts
  excluded from Git.
- GitHub App onboarding now exposes a configured `GITHUB_APP_SLUG` as a direct
  install/repository-access link in the dashboard's GitHub operations screen.
- A non-destructive `scripts/stack-smoke.ps1` command now checks API liveness,
  database readiness, dashboard serving, and optional GitHub App readiness
  after a deployment without printing credentials.
- The PostgreSQL backup and restore runbooks pass the configured database role
  explicitly; a live drill caught and corrected the previous container-user
  default that caused `pg_dump` to try the nonexistent `root` role.
- A confirmation-gated backup/restore drill now restores into a temporary
  database, compares representative tenant, integration, incident, alert,
  webhook, and tracked-event counts, and removes its temporary artifacts.
- The production Compose onboarding path was verified live: an invalid
  bootstrap token returned 401, a valid token created a tenant and one-time
  owner key, that key authenticated successfully, and a duplicate slug returned
  409; the temporary tenant was removed afterward.
- PR verification now returns the exact GitHub check-run evidence and head
  commit used to determine CI status, and persists that evidence for audit
  after reload. Missing, running, or failing checks remain unverified.
- Invariants can now declare required target check names; verification remains
  false when any configured application check is absent or unsuccessful.
- Mapped repair targets now fail closed unless they declare at least one exact
  required GitHub check, and both preview and PR creation enforce that guard.
- Operators can request a read-only preview of a repair before opening its PR.
  The preview validates the exact repair against a pinned Git base commit and
  returns bounded before/after source excerpts without creating any GitHub
  branch, file, or pull request. The production dashboard requires an
  operator to preview and explicitly confirm that exact patch before enabling
  its Create PR action; the API requires a short-lived signed approval for
  the same incident, candidate, repository, branch, and commit.
- Incident alerts now use a durable, retryable webhook outbox with HMAC-SHA256
  signatures, bounded backoff, tenant-scoped status reporting, and fail-closed
  production configuration when a URL is supplied without a secret.
- Business-outcome verification now exposes a reusable, fail-closed target
  contract (`proveBusinessOutcomeRepair`) that requires an explicit source
  loader, isolated state factory, event runner, and failure/recovery predicates;
  its fixture proof and a reviewed adapter against the real demo-SaaS
  provisioning source now exercise that contract directly.
- A repeatable `scripts/production-readiness.ps1` gate now composes stack,
  security, authenticated load, and optional backup/restore checks for release
  verification.
- A guarded `scripts/deploy-production.ps1` command now validates Compose,
  starts services, waits for API/dashboard readiness, and invokes that release
  gate with bounded failure diagnostics.
- The readiness gate now includes an opt-in duration-based capacity smoke that
  reports throughput, latency, status counts, and an enforced error-rate limit;
  hosted sustained-capacity results are still outstanding.
- The readiness gate now also includes an opt-in read-only browser smoke for
  the production dashboard's live command center, repair-target panel, and
  diagnosis modal.
- A guarded demo mapping command now validates exact source preconditions and
  required checks before configuring the reviewed Stripe predicate targets. It
  can now also configure the exact demo provisioning adapter target, requiring
  both `verify` and `business-outcome` checks.
- The guarded deployment command now forwards the optional dashboard and
  sustained-capacity gates, allowing one release command to run the complete
  local readiness suite.
- A separate `scripts/hosted-readiness.ps1` gate now runs the same checks
  against public HTTPS API/dashboard URLs without starting or mutating a local
  Compose stack. It rejects localhost endpoints and keeps the hosted operator
  key in an external env file.
- A `scripts/bootstrap-hosted-tenant.ps1` helper now creates the first hosted
  tenant from an external bootstrap-token env file, prints the one-time owner
  key without persisting it, and supports a no-request dry run.
- On 2026-10-01, the rebuilt Docker stack at `201a970` passed the complete
  readiness suite:
  GitHub App readiness, security smoke, authenticated load (20/20 HTTP 200),
  dashboard browser smoke, and paced sustained capacity (39/39 HTTP 200 with
  a 0% error rate).
- The production API now drains on `SIGTERM`/`SIGINT`, stops the evaluator,
  disconnects Prisma, and logs shutdown failures. Production Compose services
  now use restart policies, init/signal forwarding, bounded stop grace periods,
  and an explicit readiness healthcheck.
- Production metrics are now fail-closed: `/metrics` returns 404 unless the
  deployment supplies the secret `METRICS_TOKEN` and the caller presents it
  through a dedicated header or Bearer token. The security smoke covers the
  unauthenticated case.

## Not complete

1. **Production GitHub App deployment.** The local stack now has a real App
   installation, repository permissions, a public webhook URL, and a verified
   `200` delivery. A provider-specific Render Blueprint is now committed for
   the API, dashboard, and PostgreSQL. Production rollout still needs a Render
   workspace to apply it, secure secret entry, hosted tenant-isolated
   onboarding, and public webhook verification.
2. **Repository-aware repair workflow.** Invariants can now store an explicit
   `repairRepository` and `repairFilePath`, and a structured predicate edit
   is generated only for a mapped target. Three reviewed Stripe predicate
   invariants are mapped to the demo repository and require `verify`; the
   provisioning invariant now has a reviewed demo adapter target and requires
   both `verify` and `business-outcome`. GitHub invariants remain unmapped until
   their target behavior is reviewed. Most other repair types are suggestions only. The
   API supports a read-only patch preview, and the production dashboard
   displays its pinned source excerpts before a PR can be opened. The
   dashboard also edits and saves the explicit repository/file mapping.
3. **End-to-end repair proof.** The provisioning invariant now generates a
   structured patch only for the exact reviewed demo-SaaS target and requires
   the target `business-outcome` check in addition to generic CI. This is still
   not a generic sandbox for arbitrary customer repositories. Each customer
   target still needs its own reviewed adapter and full test command. Replay
   still tests a user-entered event transformation, and PR #4 remains open for
   human review; CI evidence is not the same as proving the business outcome
   in production.
4. **Production operations.** Public deployment, secure secret storage,
   hosted tenant onboarding, and sustained capacity/load testing remain to be
   completed before a production launch. Backup/restore, security, and bounded
   load drills are now repeatable; secure secret storage and public deployment
   still require a real hosting environment.
5. **Dashboard data fidelity.** The production command view now uses only live
   SHAPI incidents, shows exact active/severity/integration/invariant counts,
   and avoids presenting invented regions, map coordinates, correlation
   confidence, availability percentages, request rates, or sample incidents as
   telemetry. Geographic regional telemetry is intentionally not shown because
   SHAPI does not collect location data yet. CI now builds both the legacy
   workspace dashboard and the production `dashboard/` app.

## Next engineering priority

Review target behavior for the remaining GitHub invariants, then extend the
target-app business-outcome harness beyond its current demo adapter before
claiming arbitrary repository repairs are verified. The next release blocker is
still applying the hosted Blueprint with secure secrets and tenant-isolated
onboarding; local deployment and readiness gates are now repeatable. Do not
claim a replay-verified fix prematurely.

## Local checks

```sh
pnpm typecheck
pnpm --filter @shapi/backend lint
pnpm --filter @shapi/backend... build
pnpm --filter @shapi/backend test
pnpm --filter @shapi/github-integration test
pnpm --dir dashboard build
docker compose --env-file .env -f docker-compose.production.yml ps
```

Do not run the legacy incident E2E script against a database you need to
preserve: it deletes and recreates seeded invariant-evaluation rows.
