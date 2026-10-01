# SHAPI product status

Updated 2026-10-01. This is a current-state checklist, not a claim that the
product is production-ready. See [README.md](README.md) for setup and API details.

## Verified in this repository

- The local production Docker stack runs PostgreSQL, the backend, and the
  dashboard. On 2026-09-30, `/health`, `/ready`, and the dashboard returned 200.
- GitHub Actions CI on `master` passed for the latest dashboard commit `7b58199`:
  [run 36901061649](https://github.com/SriVarshini09/self-healing-api/actions/runs/36901061649).
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
- Production startup now fails closed when placeholder JWT secrets or partial
  GitHub App/token credentials are supplied, preventing an unsafe deployment
  from appearing healthy.
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

## Not complete

1. **Production GitHub App deployment.** The local stack now has a real App
   installation, repository permissions, a public webhook URL, and a verified
   `200` delivery. Production rollout still needs hosted deployment, secure
   secret management, and tenant-isolated onboarding.
2. **Repository-aware repair workflow.** Invariants can now store an explicit
   `repairRepository` and `repairFilePath`, and a structured predicate edit
   is generated only for a mapped target. One Stripe invariant is now mapped
   and has produced the verified PR above; other invariants remain unmapped
   until configured. Most other repair types are suggestions only. The API
   supports a read-only patch preview, and the production dashboard displays
   its pinned source excerpts before a PR can be opened. The dashboard also
   edits and saves the explicit repository/file mapping.
3. **End-to-end repair proof.** The repository now has a dedicated business-
   outcome regression check, but replay still tests a user-entered event
   transformation rather than executing a proposed code patch against the
   target application's full test suite. The real PR and CI verification path
   is proven, but the repair is not merged and CI success is not the same as
   proving the business outcome in production.
4. **Production operations.** Public deployment, secure secret storage,
   database backup/restore drills, tenant onboarding, alert delivery, and
   security/load testing remain to be completed before a production launch.
5. **Dashboard data fidelity.** The regional incident panel now uses live
   SHAPI incidents when available, but parts of the fleet/globe view still use
   preview data.

## Next engineering priority

Use the required-check contract with a real GitHub App and target repository
workflow, then add a true business-outcome test rather than treating CI
success alone as proof. Do not claim a replay-verified fix prematurely.

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
