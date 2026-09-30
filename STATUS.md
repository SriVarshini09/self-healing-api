# SHAPI product status

Updated 2026-09-30. This is a current-state checklist, not a claim that the
product is production-ready. See [README.md](README.md) for setup and API details.

## Verified in this repository

- The local production Docker stack runs PostgreSQL, the backend, and the
  dashboard. On 2026-09-30, `/health`, `/ready`, and the dashboard returned 200.
- GitHub Actions CI on `master` passed for commit `87998cb`:
  [run 36785136267](https://github.com/SriVarshini09/self-healing-api/actions/runs/36785136267).
  CI checks workspace types, backend lint, package/backend unit tests, backend
  and dashboard builds, and Prisma schema validation.
- Webhook and SDK events feed behavioral invariants; drift detection and
  incident creation are implemented. Tenant-scoped API keys and invariant
  quotas are enforced.
- Diagnosis persists repair candidates once per newly detected incident.
  Replay and PR actions cannot reopen resolved or dismissed incidents.
- Real GitHub repair PR creation is implemented for a persisted candidate with
  structured file changes. It reads the target repository at a pinned base
  commit, checks exact edit preconditions, and writes resulting file contents.
  Human-readable diffs are never committed as file contents. PR verification
  checks GitHub CI and merge state separately.
- Operators can request a read-only preview of a repair before opening its PR.
  The preview validates the exact repair against a pinned Git base commit and
  returns bounded before/after source excerpts without creating any GitHub
  branch, file, or pull request.

## Not complete

1. **GitHub App deployment.** The local stack currently has token mode, not
   `GITHUB_APP_ID` plus private-key credentials. A real App installation,
   repository permissions, public webhook URL, and delivery test still require
   operator-owned GitHub setup. Token mode is useful for local/operator use but
   is not a substitute for tenant-isolated App installations.
2. **Repository-aware repair workflow.** Invariants can now store an explicit
   `repairRepository` and `repairFilePath`, and a structured predicate edit
   is generated only for a mapped target. Existing invariants remain unmapped
   until configured. Most other repair types are suggestions only. The API
   supports a read-only patch preview, but dashboard controls for previewing
   it and editing the mapping are still missing.
3. **End-to-end repair proof.** Replay currently tests a user-entered event
   transformation; it does not execute a proposed code patch against the
   target application's tests. Passing replay is not yet a prerequisite for
   opening a PR. CI verification confirms GitHub check runs and merge state,
   not the business outcome in production.
4. **Production operations.** Public deployment, secret management, database
   backup/restore drills, tenant onboarding, alert delivery, and security/load
   testing remain to be completed before a production launch.
5. **Dashboard data fidelity.** The dashboard reads live incident/API data
   where available, but parts of the fleet/globe view still use preview data.

## Next engineering priority

Add dashboard controls for the invariant's repository-file mapping and the
read-only patch preview. Then gate PR creation on an explicit operator review
of the exact source and replacement, without claiming a replay-verified fix.

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
