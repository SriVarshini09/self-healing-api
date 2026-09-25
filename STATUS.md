# SHAPI - Behavioral Dependency Assurance Platform
## MVP Build Status

**Last Updated**: 2026-09-18
**Current Phase**: MVP complete + verified live against Postgres (Docker running)

---

## Build Order Progress

| # | Component | Status | Notes |
|---|-----------|--------|-------|
| 1 | Scaffold monorepo | ✅ Done | pnpm workspaces, tsconfig, eslint, prettier — verified |
| 2 | Backend API | ✅ Done | Fastify + Prisma, `tsc --noEmit` green, no-DB smoke test passes (`/health`, `/`, full route tree) |
| 3 | Dashboard | ✅ Done | React + Vite UI (overview/integrations/invariants/incidents/drift/events); `tsc` green, `vite build` green |
| 4 | Demo SaaS App | ✅ Done | Express receiver + in-memory users + failure-mode toggle; `tsc` green, contract test passes |
| 5 | Stripe Webhook Flow | ✅ Done | `demo-saas/scripts/simulate.ts` (success/failure/drift); backend `POST /api/v1/webhooks/stripe` ingests + evaluates invariants; **real `stripe.webhooks.constructEvent` HMAC verification** via `services/stripe.ts` with raw-body capture (`fastify-raw-body` v4, route opt-in), test-mode fallback for local simulate; 4 verification tests |
| 6 | Instrumentation SDK | ✅ Done | `@shapi/sdk` track + webhookReporter; 3 tests pass |
| 7 | Invariant Engine | ✅ Done | `@shapi/invariant-engine` validate/evaluate/window/health; 8 tests pass; TS-`as`-cast bug found by test and fixed; predicates run in **node:vm sandbox** (minimal `event` global, 100ms timeout, deep-cloned input) — zero `new Function` in codebase; backend routes/services share it; **event-type relevance scoping** (`extractPredicateEventTypes`/`isRelevantEvent`) so webhooks only evaluate invariants that scope to their type — no false violations across event types |
| 8 | Drift Detection | ✅ Done | `@shapi/drift-detection` z-test + effect size + package tests (3 pass); backend check + incident creation implemented |
| 9 | Incident UI | ✅ Done | Dashboard incidents tab: list/detail/diagnose/timeline/repair candidates |
| 10 | GitHub Integration | ✅ Done | Webhook verify, installation/PR handlers, `(prisma as any).gitHub*` naming fixed; **real Octokit PR creation** (`openRepairPr`: branch from main, commit files, open PR) with simulation fallback when `GITHUB_TOKEN` unset; `@shapi/github-integration` 5 tests pass |
| 11 | Diagnosis Engine | ✅ Done | Backend service + pure `@shapi/diagnosis-engine` heuristics; 3 tests pass; wired to `POST /incidents/:id/diagnose`; cites tracked failed business outcomes as primary evidence (0.9 confidence) with reason + correlationId — verified live: "4 failed business outcome(s) tracked in 24h (latest: provisioning.failed — provisioning skipped (simulated bug))" |
| 12 | Replay Engine | ✅ Done | Backend service + pure `@shapi/replay-engine`; 1 test passes; wired to `POST /incidents/:id/replay` |
| 13 | Repair Generation | ✅ Done | Backend service + pure `@shapi/repair-generation`; 1 test passes; candidates persisted on diagnose |
| 14 | Verified PR Workflow | ✅ Done | `POST /github/incidents/:id/pr` (body from diagnosis + top repair candidate; real Octokit when `GITHUB_TOKEN` set, simulated otherwise) + `/github/prs/:prId/verify`, PR body builder + automerge gate tested |

---

## Test Report (all passing, 36 unit tests + 6 live checks)

| Suite | Result |
|---|---|
| `@shapi/invariant-engine` | 8/8 pass (incl. sandbox isolation + loop-timeout + relevance tests) |
| `@shapi/drift-detection` | 3/3 pass |
| `@shapi/sdk` | 4/4 pass (incl. telemetry-resilience regression test) |
| `@shapi/diagnosis-engine` | 3/3 pass (incl. failed-outcome prioritization) |
| `@shapi/replay-engine` | 1/1 pass |
| `@shapi/repair-generation` | 1/1 pass |
| `@shapi/github-integration` | 5/5 pass (incl. real-PR flow via injected client) |
| `@shapi/backend` webhooks + stripe verify + api-keys | 10/10 pass |
| `@shapi/demo-saas` contract | 1/1 pass |
| Backend `tsc --noEmit` | green |
| Dashboard `tsc` + `vite build` | green |
| Demo-saas `tsc` | green |
| Backend Fastify smoke (no DB) | passes — `/health` 200, `/` 200, all routes registered |

## Live-DB run (verified 2026-09-18, Docker running)

- `docker compose up -d` ✅, `pnpm db:push` ✅, `pnpm db:seed` ✅ (2 integrations, 5 invariants, sample events/evals, demo API key)
- `apps/backend/scripts/e2e.ts` → **E2E OK**: health 200, 2 integrations, 5 invariants, good webhook 200, bad-business webhook still 200, SDK track 201, drift summary 200, 5 webhook events persisted
- `apps/backend/scripts/e2e-incident.ts` → **INCIDENT E2E OK**: drift detected (p≈7.8e-9, effect −1.0, 80%→40%), incident created, diagnose 200 with root cause + 4 repair candidates, status TRIAGED, replay 201
- `apps/demo-saas/scripts/e2e.ts` → **DEMO E2E OK**: 200-OK-despite-failure contract holds, success path provisions
- `apps/backend/scripts/stack-check.ts` → **STACK CHECK OK**: backend :3001 + demo-saas :3000 + dashboard preview :5173 booted together; failure webhook 200 over HTTP, backend ingested+processed it, SDK events reachable, dashboard serves built UI with working API wiring; pre-flight port check fails fast on stale servers
- Post-upgrade re-verification (Stripe SDK verify, Octokit wiring, vm sandbox): all unit tests + backend E2E + incident E2E + stack check green; DB reseeded pristine
- Dashboard browser test (`scripts/dashboard-test.ts`, headless Chromium): all 6 tabs render, 0 JS errors, 0 failed API calls; screenshots in `apps/dashboard/test-results/`; caught + fixed two bugs found via screenshots — seed predicates used flat payload paths instead of the Stripe `data.object` envelope, and the evaluator marked invariants VIOLATED on irrelevant event types (now scoped by `isRelevantEvent`)
- SDK-track → invariant wiring: `POST /sdk/track` evaluates the same engine via shared `services/invariants.ts` (`evaluateInvariantsForEvent`); violations open deduped HIGH incidents, so `simulate:failure` now ends with a real incident without any manual step. Seed gained `No Failed Provisioning Invariant` (`event.type !== 'provisioning.failed'`); demo-saas tracks full-fidelity envelopes (a lossy subset once caused a false payment violation). Verified: stack check asserts violated invariant + exactly 1 incident; overview screenshot shows it live
- Bug found live: SDK `webhookReporter` let telemetry failures skip business logic — fixed (safeTrack) + regression test added
- DB reset + reseeded clean after E2E runs mutated eval data (`prisma db push --force-reset` + `db:seed`)

---

## Architecture Decisions

- **Monorepo**: pnpm workspaces
- **Backend**: Fastify + TypeScript + Prisma ORM (+ dotenv loading repo-root `.env`)
- **Database**: PostgreSQL (local Docker)
- **Dashboard**: React 18 + Vite (no router; tab UI over fetch)
- **Demo SaaS**: Express (not Next.js — lighter for MVP, documented in README) + Stripe-style webhooks
- **SDK**: TypeScript, framework-agnostic
- **Testing**: Vitest (unit, no DB required)
- **Predicates**: plain JavaScript only (validators reject TS `as` casts); sandbox with `new Function` for MVP, `isolated-vm` recommended for prod

---

## Key Concepts

### Behavioral Invariants
Expected business outcomes, not HTTP status. Executable JS predicates over webhook events, versioned in DB.

### Drift Detection
Two-proportion z-test over baseline (30d) vs current (1h) windows; thresholds p < 0.01, |d| >= 0.5.

### Incident Lifecycle
DETECTED → TRIAGED → REPLAYING → REPAIRED → RESOLVED (DISMISSED escape hatch).

---

## Next Steps

1. `pnpm dev`, run simulate success/failure/drift, verify dashboard incidents visually
2. Set `STRIPE_WEBHOOK_SECRET` to a real `whsec_...` + point Stripe CLI at `/api/v1/webhooks/stripe` for a true end-to-end signature check
3. Set `GITHUB_TOKEN` and create a repair PR against a real repo to exercise the Octokit path
4. For untrusted multi-tenant predicates, upgrade the node:vm sandbox to isolated-vm

## CI

- `.github/workflows/ci.yml`: install (frozen lockfile) → `pnpm -r typecheck` (verified green locally) → all DB-free unit tests → dashboard build → `prisma validate`

## API-key auth (enforced)

- Every `/api/v1` route requires `x-api-key` except third-party webhook receivers (`/webhooks/*`, GitHub app webhook) which carry their own HMAC auth. `/health`, `/`, `/docs` stay public.
- Keys stored as SHA-256 in `APIKey` (permissions + expiry checked). Seed provisions a fixed local-dev key (`SHAPI_API_KEY`); rotate per environment for real use.
- Dashboard sends the key (`VITE_SHAPI_API_KEY`, dev default baked in); SDK already sent it; demo-saas default updated.
- Verified: e2e asserts 401 without/wrong key; stack + browser suites run authenticated.
