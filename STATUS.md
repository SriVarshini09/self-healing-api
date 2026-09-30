# SHAPI product status

Updated 2026-09-30. This is a current-state checklist, not a claim that the
product is production-ready. See [README.md](README.md) for setup and API details.

## Verified in this repository

- The local production Docker stack runs PostgreSQL, the backend, and the
  dashboard. On 2026-09-30, `/health`, `/ready`, and the dashboard returned 200.
- GitHub Actions CI on `master` passed for commit `0983fd4`:
  [run 36769741818](https://github.com/SriVarshini09/self-healing-api/actions/runs/36769741818).
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

## Not complete

1. **GitHub App deployment.** The local stack currently has token mode, not
   `GITHUB_APP_ID` plus private-key credentials. A real App installation,
   repository permissions, public webhook URL, and delivery test still require
   operator-owned GitHub setup. Token mode is useful for local/operator use but
   is not a substitute for tenant-isolated App installations.
2. **Repository-aware repair generation.** Most generated candidates are
   suggestions only. The structured predicate edit assumes an
   `invariants/<name>.ts` path that may not exist in the target repository.
   SHAPI correctly rejects an inapplicable patch, but automatic PR creation
   will remain limited until integrations map invariants to real repository
   files and show a preview of the exact patch.
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

Add an explicit repository-file mapping for invariants and a read-only patch
preview. Then generate structured candidates only when the mapped file and
exact predicate text can be found. This makes the safe PR path usable without
guessing paths or claiming an unverified fix.

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
