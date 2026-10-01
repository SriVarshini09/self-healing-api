# SHAPI product status

Updated 2026-10-01. This is a current-state checklist, not a claim that the
product is production-ready. See [README.md](README.md) for setup and API details.

## Verified in this repository

- The local production Docker stack runs PostgreSQL, the backend, and the
  dashboard. On 2026-09-30, `/health`, `/ready`, and the dashboard returned 200.
- GitHub Actions CI on `master` passed for commit `9ed42a4`:
  [run 36786686064](https://github.com/SriVarshini09/self-healing-api/actions/runs/36786686064).
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

1. **GitHub App deployment.** The local stack now has a real App installation,
   repository permissions, a public webhook URL, and a verified `200` delivery.
   Full repair-PR verification still requires a mapped repair target and a
   complete PR/CI/business-outcome demonstration.
2. **Repository-aware repair workflow.** Invariants can now store an explicit
   `repairRepository` and `repairFilePath`, and a structured predicate edit
   is generated only for a mapped target. Existing invariants remain unmapped
   until configured. Most other repair types are suggestions only. The API
   supports a read-only patch preview, and the production dashboard displays
   its pinned source excerpts before a PR can be opened. The dashboard also
   edits and saves the explicit repository/file mapping.
3. **End-to-end repair proof.** Replay currently tests a user-entered event
   transformation; it does not execute a proposed code patch against the
   target application's tests. Passing replay is not yet a prerequisite for
   opening a PR. CI verification confirms GitHub check runs and merge state,
   not the business outcome in production.
4. **Production operations.** Public deployment, secret management, database
   backup/restore drills, tenant onboarding, alert delivery, and security/load
   testing remain to be completed before a production launch.
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
