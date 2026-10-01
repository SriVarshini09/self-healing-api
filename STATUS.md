# SHAPI product status

Updated 2026-10-01. This is a current-state checklist, not a claim that the
product is production-ready. See [README.md](README.md) for setup and API details.

## Verified in this repository

- The local production Docker stack runs PostgreSQL, the backend, and the
  dashboard. On 2026-09-30, `/health`, `/ready`, and the dashboard returned 200.
- GitHub Actions CI on `master` passed for the latest business-outcome proof
  commit `b7ffb1c`:
  [run 36916702743](https://github.com/SriVarshini09/self-healing-api/actions/runs/36916702743).
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
  its fixture proof now exercises that contract directly.
- A repeatable `scripts/production-readiness.ps1` gate now composes stack,
  security, authenticated load, and optional backup/restore checks for release
  verification.

## Not complete

1. **Production GitHub App deployment.** The local stack now has a real App
   installation, repository permissions, a public webhook URL, and a verified
   `200` delivery. Production rollout still needs hosted deployment, secure
   secret management, and hosted tenant-isolated onboarding.
2. **Repository-aware repair workflow.** Invariants can now store an explicit
   `repairRepository` and `repairFilePath`, and a structured predicate edit
   is generated only for a mapped target. One Stripe invariant is now mapped
   and has produced the verified PR above; other invariants remain unmapped
   until configured. Most other repair types are suggestions only. The API
   supports a read-only patch preview, and the production dashboard displays
   its pinned source excerpts before a PR can be opened. The dashboard also
   edits and saves the explicit repository/file mapping.
3. **End-to-end repair proof.** The business-outcome check now executes a
   structured patch through a reusable target-app contract, but it is not yet a
   generic sandbox for arbitrary customer repositories. Each target repository
   still needs its own reviewed adapter and full test command. Replay still
   tests a user-entered event transformation, and PR #4 remains open for human
   review; CI evidence is not the same as proving the business outcome in
   production.
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

Map the remaining production invariants to reviewed target files and extend the
target-app business-outcome harness beyond its contract fixture before claiming
arbitrary repository repairs are verified. Then run sustained capacity tests
and complete tenant-onboarding drills. Do not claim a replay-verified fix
prematurely.

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
