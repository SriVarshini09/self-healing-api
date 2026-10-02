# SHAPI product status

Updated 2026-10-02. This is a current-state checklist, not a claim that the
product is production-ready. See [README.md](README.md) for setup and API details.

## Verified in this repository

- Hosted readiness now has a secret-safe preflight that validates the external
  operator env file before any public request: it rejects placeholders, partial
  OIDC configuration, multiple GitHub private-key sources, invalid OIDC callback
  URLs, and mismatched alert-webhook settings without printing secret values.
  The local GitHub-App environment passed the preflight; the intentional OIDC
  negative check failed closed on the missing provider configuration.
- Production image builds now retry the pinned pnpm bootstrap up to five times
  in both backend and dashboard Dockerfiles, so a transient package-registry
  socket reset does not fail an otherwise valid release build. Commit `e82d385`
  passed the full local readiness gate, CI
  [36989024140](https://github.com/SriVarshini09/self-healing-api/actions/runs/36989024140),
  and Docker production validation
  [36989024124](https://github.com/SriVarshini09/self-healing-api/actions/runs/36989024124).
- The reviewed business-outcome adapter catalog now validates at module load and
  in tests. Duplicate IDs/targets, invalid confidence, malformed structured
  changes, no-op replacements, and repairs that do not touch the declared target
  fail closed before the adapter can authorize a repair. Commit `acf7214` passed
  27 repair-generation tests, 120 backend tests, and the full local production
  readiness gate.
- Docker production validation can now also be run on demand for an exact
  commit. Run [36987443677](https://github.com/SriVarshini09/self-healing-api/actions/runs/36987443677)
  passed image build, stack startup, readiness, authenticated/load checks,
  dashboard browser smoke, signed webhook replay protection, and repair-readiness
  verification on `master`.
- Render Blueprint validation can now be run on demand with the repository's
  `workflow_dispatch` trigger. The current Blueprint passed the official Render
  schema check in [36986736231](https://github.com/SriVarshini09/self-healing-api/actions/runs/36986736231);
  no Render credentials were present, so no hosted resources were changed.
- GitHub repair preview, PR creation, manual PR verification, and workflow-run
  verification now all consume the same backend repair-readiness decision used
  by the dashboard and release audit. A mapped target that loses a required
  check or its reviewed `business-outcome` proof fails closed before GitHub
  mutation and cannot remain verified. Commit `340448c` passed 30 GitHub-route
  tests, 120 backend tests, full CI
  [36985801019](https://github.com/SriVarshini09/self-healing-api/actions/runs/36985801019),
  and Docker production/browser validation
  [36985801032](https://github.com/SriVarshini09/self-healing-api/actions/runs/36985801032).
- The dashboard invariant editor and list now expose the backend's authoritative
  repair-readiness state, blocking reason, and reviewed adapter ID. Operators
  can see whether a target is ready, manual-review-only, or blocked before
  attempting a repair preview. Commit `673453f` passed local dashboard
  typecheck, tests, production build, live Docker HTTP/readiness audit, full CI
  [36985024326](https://github.com/SriVarshini09/self-healing-api/actions/runs/36985024326),
  and Docker production/browser validation
  [36985024434](https://github.com/SriVarshini09/self-healing-api/actions/runs/36985024434).
- Reviewed business-outcome adapters now carry their own exact repair
  description, diff, confidence, and structured changes. Backend repair
  generation consumes that adapter metadata, so adding a separately reviewed
  customer adapter does not require another backend invariant-ID branch; an
  adapter is still opt-in and target-coordinate matched. Commit `1e24f3b`
  passed 24 repair-generation tests, 119 backend tests, full CI
  [36984264608](https://github.com/SriVarshini09/self-healing-api/actions/runs/36984264608),
  and Docker production validation
  [36984264642](https://github.com/SriVarshini09/self-healing-api/actions/runs/36984264642).
- The release repair-readiness audit now consumes the backend's authoritative
  `repairReadiness` decision instead of duplicating a demo-only invariant ID
  and business-outcome rule in PowerShell. It fails closed when an API row is
  missing that decision, while preserving JSON output and `-FailOnUnready` for
  release checks. The live Docker audit reported 6/6 ready, with zero manual
  review or missing-check blocks. Commit `8712102` passed full CI
  [36982920667](https://github.com/SriVarshini09/self-healing-api/actions/runs/36982920667)
  and Docker production validation
  [36982920549](https://github.com/SriVarshini09/self-healing-api/actions/runs/36982920549).
- Reviewed business-outcome repair generation now selects the adapter by its
  exact repository/file coordinates instead of requiring the old provisioning
  invariant ID. A renamed invariant therefore receives the same reviewed patch
  only when it still points to that exact adapter target; unmapped targets stay
  manual. Commit `4646466` passed the full backend suite locally and full CI
  [36983496193](https://github.com/SriVarshini09/self-healing-api/actions/runs/36983496193)
  plus Docker production validation
  [36983496044](https://github.com/SriVarshini09/self-healing-api/actions/runs/36983496044).
- Business-outcome target gating is now driven by the reviewed adapter
  registry's repository/file coordinates, not by a special invariant ID. A
  renamed invariant pointing at a reviewed adapter still requires that
  adapter's exact `business-outcome` check and remains fail-closed otherwise.
  Commit `2712db8` passed 119 backend tests, full CI
  [36982229659](https://github.com/SriVarshini09/self-healing-api/actions/runs/36982229659),
  and Docker production validation
  [36982229555](https://github.com/SriVarshini09/self-healing-api/actions/runs/36982229555).
- OIDC callbacks now clear the signed login-state cookie after validation and
  combine that expiry with the new session cookie, reducing replay residue
  without exposing session values. Commit `16060e3` passed the focused auth
  tests, full CI
  [36981543936](https://github.com/SriVarshini09/self-healing-api/actions/runs/36981543936),
  and Docker production validation
  [36981543828](https://github.com/SriVarshini09/self-healing-api/actions/runs/36981543828).
- The repair review UI now shows each candidate's required checks, explains
  when a dedicated `business-outcome` proof is required in addition to generic
  CI, and allows an operator to cancel a preview before review. Commit
  `aca1676` passed the dashboard typecheck, tests, and production build; the
  production browser smoke in Docker also passed through commit `fd363f1`.
- The Docker production workflow now watches the active dashboard source tree
  at `apps/dashboard/**`, so dashboard changes cannot bypass the production
  browser gate. Commit `fd363f1` passed CI
  [36980635184](https://github.com/SriVarshini09/self-healing-api/actions/runs/36980635184)
  and Docker production validation
  [36980635117](https://github.com/SriVarshini09/self-healing-api/actions/runs/36980635117),
  including live dashboard behavior, signed webhook replay protection, and a
  6/6 repair-readiness audit.
- The local production Docker stack runs PostgreSQL, the backend, and the
  dashboard. On 2026-10-01, the backend and dashboard were rebuilt from the
  latest dashboard cleanup at `fc1ef08`; `/health`, `/ready`, the dashboard,
  and the authenticated
  `/api/v1/alerts/status` endpoint returned 200. The live alert status response
  included pending, processing, retrying, delivered, and failed counts, and the
  dashboard smoke verified all five labels in the live alert-delivery panel.
- The latest dashboard cleanup removes the unused synthetic Globe.gl component
  and its dependencies. The navigation and social metadata now describe live
  incident signals, repair review, and SHAPI outcome verification instead of
  implying geographic traffic telemetry. Dashboard typecheck, production build,
  Docker rebuild, and live browser smoke passed locally from `fc1ef08`.
- GitHub webhook routing now uses the signed payload's installation ID to resolve
  the mapped tenant integration. Known installations are processed normally;
  unknown installations are rejected instead of falling back to another
  tenant's configured integration. Commit `64768a3` passed 94 backend tests,
  the live readiness gate, CI, and production Docker validation:
  [CI run 36961198358](https://github.com/SriVarshini09/self-healing-api/actions/runs/36961198358),
  [Docker run 36961198357](https://github.com/SriVarshini09/self-healing-api/actions/runs/36961198357).
- The production command center now exposes GitHub repair connection status and
  the tenant's connected integrations on the main page, including App mode,
  repository/install counts, webhook readiness, and provider check counts. It
  does not display secrets. The live direct-API and same-origin browser smoke
  passed locally, and commit `af7ddb0` passed CI and production Docker checks:
  [CI run 36962625769](https://github.com/SriVarshini09/self-healing-api/actions/runs/36962625769),
  [Docker run 36962625753](https://github.com/SriVarshini09/self-healing-api/actions/runs/36962625753).
- The dashboard's connected-integration panel now includes an operator-safe
  setup view with the provider webhook endpoint, setup instructions, and a
  boolean secret-status indicator; the secret value is never displayed. The
  browser smoke opens this view and verifies the live `/webhook-url` request.
  Commit `7cae46f` passed full CI and production Docker validation:
  [CI run 36963183902](https://github.com/SriVarshini09/self-healing-api/actions/runs/36963183902),
  [Docker run 36963183979](https://github.com/SriVarshini09/self-healing-api/actions/runs/36963183979).
- The same panel now exposes the latest five webhook delivery states on demand,
  including event type and received time while keeping payloads and secrets
  hidden. The browser smoke opens the view and asserts the tenant-scoped
  `/webhook-events?pageSize=5` request. Commit `50e8453` passed full CI and
  production Docker validation:
  [CI run 36963752573](https://github.com/SriVarshini09/self-healing-api/actions/runs/36963752573),
  [Docker run 36963752517](https://github.com/SriVarshini09/self-healing-api/actions/runs/36963752517).
- Repair target readiness is now computed by the backend and shown directly in
  the Repair targets panel, with explicit `MANUAL_REVIEW`, blocked, or ready
  state and a human-readable reason. This keeps the dashboard aligned with the
  fail-closed repair contract instead of making operators infer readiness from
  empty fields. Commit `b49a5ed` passed 98 backend tests, full CI, and Docker
  production validation:
  [CI run 36964351802](https://github.com/SriVarshini09/self-healing-api/actions/runs/36964351802),
  [Docker run 36964351707](https://github.com/SriVarshini09/self-healing-api/actions/runs/36964351707).
- The Repair targets panel now summarizes ready, manual-review, and blocked
  counts, and the production browser smoke asserts both the visible
  `MANUAL REVIEW` and `READY FOR TARGET REVIEW` states. Commit `d1127e0` passed
  full CI and Docker production validation:
  [CI run 36965056960](https://github.com/SriVarshini09/self-healing-api/actions/runs/36965056960),
  [Docker run 36965055657](https://github.com/SriVarshini09/self-healing-api/actions/runs/36965055657).
- The complete workspace verification passed locally on 2026-10-02: all
  workspace typechecks, all workspace tests, and all workspace builds passed.
  The backend suite passed 21 test files and 112 tests, including the
  structured business-outcome proof and the real demo-SaaS adapter proof.
  The demo HTTP E2E also passed its intended failure-to-recovery flow: a
  business failure returned HTTP 200 without provisioning, followed by a
  recovered webhook that provisioned successfully.
- Predicate repair generation now makes every nested payload segment
  null-safe, including partially chained expressions such as
  `payload?.data.object`. The shared helper is used by both the repair package
  and backend candidate generation, with regression coverage for nested
  mappings. Commit `471359f` passed full CI and the production Docker workflow:
  [CI run 36966846545](https://github.com/SriVarshini09/self-healing-api/actions/runs/36966846545),
  [Docker run 36966846533](https://github.com/SriVarshini09/self-healing-api/actions/runs/36966846533).
- The nested repair regression now evaluates the generated predicate against a
  payload whose intermediate `data` object is null and proves it returns
  `false` without throwing. Commit `fd1c1f9` passed CI and Docker production
  validation:
  [CI run 36967233865](https://github.com/SriVarshini09/self-healing-api/actions/runs/36967233865),
  [Docker run 36967233874](https://github.com/SriVarshini09/self-healing-api/actions/runs/36967233874).
- GitHub PR and workflow invariants now use null-safe nested access, so
  incomplete webhook payloads fail closed as failed samples instead of
  throwing evaluation errors. The migration also updates existing seeded
  invariants in place, and five focused GitHub invariant tests cover valid,
  invalid, and incomplete payloads. Commit `435af8d` passed the full CI and
  production Docker workflows:
  [CI run 36967773717](https://github.com/SriVarshini09/self-healing-api/actions/runs/36967773717),
  [Docker run 36967773694](https://github.com/SriVarshini09/self-healing-api/actions/runs/36967773694).
- Candidate readiness now independently enforces the reviewed demo
  business-outcome check, even if stale persisted data bypasses the invariant
  mapping endpoint. The new regression keeps that candidate in manual review
  with only `verify`, and permits PR review only when `business-outcome` is
  also present. Commit `3923261` passed 102 backend tests, the full workspace
  checks, live production readiness, CI, and Docker validation:
  [CI run 36968322179](https://github.com/SriVarshini09/self-healing-api/actions/runs/36968322179),
  [Docker run 36968322137](https://github.com/SriVarshini09/self-healing-api/actions/runs/36968322137).
- Reviewed business-outcome adapters now have an explicit registry and stable
  adapter IDs. Readiness responses and the production dashboard identify the
  reviewed adapter instead of inferring it from a file path; unknown customer
  targets remain unrecognized and fail closed. Commit `4e7af0e` passed the
  live readiness gate, full CI, and Docker validation:
  [CI run 36968884407](https://github.com/SriVarshini09/self-healing-api/actions/runs/36968884407),
  [Docker run 36968884448](https://github.com/SriVarshini09/self-healing-api/actions/runs/36968884448).
- The two GitHub invariants now declare the reviewed predicate source target
  `apps/backend/src/services/github-invariants.ts` and require the exact
  `verify` check before target review. The local tenant was updated through the
  controlled mapping script and the live audit now reports 6/6 targets ready,
  0 manual-review targets, and 0 blocked targets. This remains target review,
  not automatic merging or a business-outcome adapter.
- The seed now persists all six reviewed repair mappings in a clean database,
  including the demo business-outcome adapter. A fresh Docker seed and audit
  report 6/6 ready, 0 manual-review targets, and 0 blocked targets, so clean
  CI/deployment environments no longer depend on a local operator script.
- Docker production CI now installs the pinned Playwright browser on the
  runner and executes the production dashboard smoke against the real Docker
  dashboard and same-origin API proxy. This makes the command center, live
  telemetry, repair review, readiness states, alert delivery, and diagnosis
  flow part of the production gate instead of a local-only check.
- The production dashboard now supports the documented OIDC-only deployment
  path: it checks the browser session before loading tenant data, offers an
  explicit SSO sign-in action when needed, and explains when neither OIDC nor
  a runtime API key is configured. API-key-backed deployments remain
  unchanged. Commit `da9cc5e` passed dashboard typecheck/build, live Docker
  browser smoke, CI, and Docker production validation.
- The production OIDC dashboard now exposes a sign-out action, and the Docker
  browser smoke verifies that an authenticated session calls `/auth/logout`.
  Backend unit coverage now protects hashed session creation, role-derived
  permissions, expiry cleanup, logout deletion, and the `/auth/*` route
  contracts. Commits `d7536fe`, `59d1551`, and `7076c65` passed local checks;
  the latest CI run `36975964752` and Docker run `36975964816` both passed.
- The OIDC route suite now covers the valid callback path as well as invalid
  state: discovery, authorization-code exchange, profile lookup, tenant-scoped
  user creation, session creation, and safe dashboard redirect. Commit
  `01c4c95` passed 114 backend tests, full CI
  [36978157447](https://github.com/SriVarshini09/self-healing-api/actions/runs/36978157447),
  and Docker production validation
  [36978157430](https://github.com/SriVarshini09/self-healing-api/actions/runs/36978157430).
- The Render Blueprint now declares the complete OIDC configuration surface as
  explicit secret-backed inputs, including the provider callback URI and
  default tenant slug. Hosted setup documentation points the identity provider
  to `/api/v1/auth/callback`; commit `db1557c` passed the Render Blueprint
  schema workflow [36976870634](https://github.com/SriVarshini09/self-healing-api/actions/runs/36976870634),
  CI [36976870795](https://github.com/SriVarshini09/self-healing-api/actions/runs/36976870795),
  and Docker production [36976870670](https://github.com/SriVarshini09/self-healing-api/actions/runs/36976870670).
- Production Compose now explicitly passes the full OIDC configuration surface
  into the backend, and Docker CI asserts the enabled `/api/v1/auth/config`
  response with synthetic non-provider values. Commit `710f906` passed local
  Compose validation, a rebuilt Docker dashboard smoke, full CI
  [36977612531](https://github.com/SriVarshini09/self-healing-api/actions/runs/36977612531),
  and Docker production validation
  [36977612442](https://github.com/SriVarshini09/self-healing-api/actions/runs/36977612442).
- Production startup now rejects partial OIDC configuration instead of silently
  disabling SSO when a hosted deployment supplies only some identity settings.
  Commit `03bfbe2` passed the complete and partial OIDC configuration tests,
  local Docker rebuild/dashboard smoke, CI
  [36978759311](https://github.com/SriVarshini09/self-healing-api/actions/runs/36978759311),
  and Docker production validation
  [36978759400](https://github.com/SriVarshini09/self-healing-api/actions/runs/36978759400).
- OIDC provider discovery, token exchange, and profile lookup now use a bounded
  timeout and return controlled `502` responses for provider outages or
  malformed responses; discovery failures also reset the metadata cache so a
  later login can recover. Commit `4ce4487` passed the full workspace test,
  typecheck, and build suites, CI
  [36979436149](https://github.com/SriVarshini09/self-healing-api/actions/runs/36979436149),
  and Docker production validation
  [36979436198](https://github.com/SriVarshini09/self-healing-api/actions/runs/36979436198).
- The OIDC provider timeout is now explicitly wired through production Compose,
  the Render Blueprint, and the deployment README (default `10000` ms), so a
  hosted operator can tune the bounded provider-call window without changing
  application code. Commit `3645bc9` passed CI
  [36979970190](https://github.com/SriVarshini09/self-healing-api/actions/runs/36979970190),
  Docker production validation
  [36979970294](https://github.com/SriVarshini09/self-healing-api/actions/runs/36979970294),
  and Render Blueprint schema validation
  [36979970208](https://github.com/SriVarshini09/self-healing-api/actions/runs/36979970208).
- Docker production CI now verifies the signed GitHub webhook path and replay
  deduplication inside the backend container, then runs the authenticated
  repair-readiness audit. The webhook smoke uses Node byte-exact UTF-8
  requests so the signature check is deterministic across CI and local Docker
  environments. The latest Docker workflow also passes the signed smoke and
  repair audit.
- CI now runs the same complete workspace build and test coverage instead of
  a hand-picked package list. The workflow change passed all workspace
  builds, tests, typechecks, backend lint, production dashboard build, Prisma
  validation, and the business-outcome job in [CI run 36965845415](https://github.com/SriVarshini09/self-healing-api/actions/runs/36965845415).
- Integration creation now redacts generated webhook secrets from its response;
  the secret remains write-only and the regression test confirms the API returns
  only `webhookSecretConfigured`. Commit `0a70a92` passed both full CI and the
  production Docker workflow:
  [CI run 36962263558](https://github.com/SriVarshini09/self-healing-api/actions/runs/36962263558),
  [Docker run 36962263552](https://github.com/SriVarshini09/self-healing-api/actions/runs/36962263552).
- The latest production-code head `d1127e0` passed GitHub Actions CI, including
  the business-outcome regression, production builds, unit tests, and Prisma
  validation:
  [run 36965056960](https://github.com/SriVarshini09/self-healing-api/actions/runs/36965056960).
  It also passed the production Docker workflow, including Compose validation,
  image builds, stack readiness, authenticated security/load checks, and the
  non-root backend assertion:
  [run 36965055657](https://github.com/SriVarshini09/self-healing-api/actions/runs/36965055657).
  The follow-up status-ledger commit `092eec5` passed full CI in
  [run 36960535445](https://github.com/SriVarshini09/self-healing-api/actions/runs/36960535445).
  Subsequent documentation-only commits were also verified by full CI.
  Render Blueprint schema validation for the workflow-hardening change passed:
  [run 36954469954](https://github.com/SriVarshini09/self-healing-api/actions/runs/36954469954).
- Alert webhook request construction is now a tested core contract: the exact
  JSON body, provider-neutral event, delivery headers, and HMAC signature are
  built together and covered by backend tests. This change does not call an
  external receiver during tests. Commit `c781914` passed full CI, including
  typecheck, lint, builds, unit tests, Prisma validation, and the business-
  outcome regression in [run 36958277897](https://github.com/SriVarshini09/self-healing-api/actions/runs/36958277897).
  The production Docker workflow also passed Compose validation, image builds,
  stack startup, readiness, authenticated security/load checks, and teardown
  in [run 36958277884](https://github.com/SriVarshini09/self-healing-api/actions/runs/36958277884).
- Alert outbox delivery transitions are now covered without a real network
  receiver: a successful 2xx response must mark a claimed delivery `DELIVERED`,
  while a receiver failure must return it to `RETRYING` with the exact bounded
  backoff and persisted error. The focused alert suite now has 8 tests, and the
  full backend suite has 92 tests. Commit `e42b32d` passed CI and production
  Docker validation in the runs recorded above.
- The production command center now labels live incident activity as incidents,
  reports the actual active-incident count, and shows incident severity/state
  instead of presenting severity as an action or inventing a region value.
  Browser smoke requires the corrected incident headings in both direct-API and
  same-origin proxy modes. Commit `296a7b0` passed the production dashboard
  smoke locally and the CI/Docker runs recorded above.
- CI, Docker production, and Render Blueprint workflows now declare
  read-only repository permissions and cancel obsolete same-branch runs, so
  superseded commits do not continue consuming runners.
- Repair-candidate readiness responses now include the exact required GitHub
  check names, and the production dashboard displays them beside each
  candidate. Operators can see the verification gate before previewing or
  creating a repair PR.
- The separate `business-outcome` check includes the real demo HTTP
  checkout/webhook flow; CI passes both the failure-that-still-returns-200
  assertion and the recovered provisioning assertion. CI also checks workspace
  types, backend lint, package/backend unit tests, backend and dashboard
  builds, and Prisma schema validation.
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
- The live command center now shows the repair-review queue from active API
  candidates, including the number requiring manual review and the number
  that are PR-ready after review. Browser smoke covers this queue, so the
  dashboard does not imply that every detected suggestion is automatically
  repairable.
- Repair-review counts now fail closed when readiness metadata is missing, and
  dashboard smoke cross-checks the displayed manual-review and PR-ready totals
  against the live incidents API rather than checking only the section label.
- Repair candidates without both an explicit repository mapping and structured
  file changes are now labeled `MANUAL REVIEW` in the production dashboard;
  preview and PR actions stay disabled with an explanation, so a suggestion
  cannot be mistaken for an automated repair.
- The backend incident API now exposes the same fail-closed decision as
  `reviewStatus`, `automationEligible`, and `reviewReason` on incident list,
  detail, update, diagnosis, and timeline responses. This keeps non-dashboard
  clients from treating unmapped or unstructured suggestions as automatable
  repairs; the live API check returned `MANUAL_REVIEW=10` and
  `PR_READY_AFTER_REVIEW=2` after the change.
- Both production dashboards now consume those API readiness fields directly,
  and the shared repair-candidate schema documents them for clients. The
  rebuilt Docker stack passed dashboard browser smoke after this alignment:
  [Docker run 36945793708](https://github.com/SriVarshini09/self-healing-api/actions/runs/36945793708).
- GitHub pull-request webhook handling now ignores non-lifecycle actions such
  as `synchronize` instead of falling through to `OPEN` and potentially
  reopening a closed repair PR. A regression test covers the closed-PR case;
  the rebuilt Docker production workflow passed after the fix:
  [Docker run 36946499075](https://github.com/SriVarshini09/self-healing-api/actions/runs/36946499075).
- GitHub workflow webhooks now clear stale repair verification when a
  referenced workflow is running or completes unsuccessfully, so an older
  green result cannot remain authoritative. Regression tests cover both
  `in_progress` and failed-completion events; the production Docker workflow
  passed after this hardening:
  [Docker run 36947091720](https://github.com/SriVarshini09/self-healing-api/actions/runs/36947091720).
- The legacy workspace dashboard now applies the same manual-review guard and
  no longer offers a preview action for empty or unmapped repair changes.
- Invariant settings now let operators create or edit the repository/file
  repair mapping and required GitHub check names without using the API.
- The seeded GitHub PR-merged and workflow-success predicates now live in a
  named backend module with regression tests covering valid, invalid, and
  in-progress events. Their repair targets remain intentionally unmapped until
  target behavior is reviewed.
- Incident PRs now display persisted verification evidence after reload,
  including the exact verified head SHA and individual check conclusions.
- Changing an invariant's predicate, repair target, or required checks now
  invalidates verification on actionable open/draft repair PRs while preserving
  historical merged/closed evidence, preventing stale green badges.
- On 2026-10-01, the live Docker stack completed a read-only dashboard preview
  against the real installation and returned the current `master` SHA, one
  changed file, and a signed preview approval token without creating a PR.
- The demo SaaS now has a dedicated business-outcome regression check proving
  that the simulated provisioning failure leaves the user unprovisioned and
  that the corrected handler recovers the same user. GitHub Actions runs this
  as a separate `business-outcome` check.
- The separate `business-outcome` check now also runs the demo's HTTP-level
  checkout → Stripe webhook flow and verifies both the deceptive `200` failure
  and the recovered provisioned user. The E2E server now closes cleanly on
  Windows instead of force-exiting with an open listener.
- The `business-outcome` check now also applies a structured repair change to a
  target-app provisioning source fixture, executes the patched handler, and
  proves the same user becomes provisioned. It fails closed when the reviewed
  source precondition has drifted.
- The business-outcome proof now also fails closed when reviewed changes omit
  the declared target file or leave its source unchanged; regression tests cover
  both cases so a green result cannot come from an untested or no-op patch.
- Production startup now fails closed when placeholder JWT secrets or partial
  GitHub App/token credentials are supplied, preventing an unsafe deployment
  from appearing healthy.
- GitHub App private keys can now be supplied directly, from a mounted secret
  file, or as one-line base64; startup validation requires exactly one source,
  which avoids multiline `.env` corruption in Windows and hosted secret stores.
- GitHub readiness reporting and repair preview/PR authorization now use the
  same resolved key-source logic, so the file and base64 forms work for the
  actual hosted repair workflow—not only for startup validation.
- The production dashboard setup guide now lists the same three key-source
  options and recommends the hosted-safe base64/file forms, avoiding a setup
  path that would still instruct operators to paste multiline PEM values.
- GitHub App webhook deliveries are now persisted and deduplicated by
  `X-GitHub-Delivery`; retries acknowledge the recorded event without
  repeating lifecycle processing, while completed/failed processing remains
  auditable in the existing webhook-event table.
- The Render Blueprint now passes the official Render schema validation; preview
  generation is explicitly disabled with the supported `off` value.
- `.github/workflows/render-blueprint.yml` revalidates the Blueprint against
  Render's official public schema whenever `render.yaml` or its validation
  workflow changes. It also enables full Render CLI semantic validation when
  optional workspace credentials are supplied as repository secrets.
- `.github/workflows/docker-production.yml` validates the production Compose
  configuration, builds both production images, starts the full PostgreSQL/API/
  dashboard stack, verifies API and dashboard readiness, and tears it down on
  relevant changes. The current run passed on 2026-10-01:
  [run 36938673777](https://github.com/SriVarshini09/self-healing-api/actions/runs/36938673777).
- Docker production CI now also runs when deployment scripts, Render Blueprint
  configuration, or provider deployment assets change. The filter change passed
  the full image build, stack startup, readiness verification, and teardown:
  [run 36943193335](https://github.com/SriVarshini09/self-healing-api/actions/runs/36943193335).
- Docker production CI now also seeds a disposable CI tenant and verifies
  unauthenticated rejection, invalid-key rejection, metrics protection, and
  authenticated load before teardown. The complete expanded gate passed:
  [run 36943697995](https://github.com/SriVarshini09/self-healing-api/actions/runs/36943697995).
- Optional GitHub App configuration now treats an empty `GITHUB_APP_SLUG` as
  unset, so tokenless CI and deployments do not fail schema validation while
  real App credentials remain validated when supplied.
- The production Docker images now honor hosted `PORT` values, use a dynamic
  dashboard Nginx listener and backend healthcheck, and the Render Blueprint
  wires the dashboard proxy to the API service's private host/port. The
  provider-shaped dashboard image test and official Render schema validation
  passed locally on 2026-10-01.
- The hardened business-outcome proof passed the live Docker readiness gate on
  2026-10-01, including GitHub App readiness, security checks, 20/20
  authenticated requests, and dashboard browser smoke. Earlier successful
  Docker workflow runs are retained below as historical evidence; the latest
  matching run is recorded near the top of this file.
- The production dashboard smoke now verifies both direct API wiring and the
  hosted-style same-origin `/api/v1` Nginx proxy, including runtime `config.js`
  injection. The Docker production workflow passed this proxy check:
  [run 36941705351](https://github.com/SriVarshini09/self-healing-api/actions/runs/36941705351).
- The dashboard repair-candidate guard passed the full local readiness gate on
  2026-10-01: API liveness, database readiness, dashboard serving, GitHub App
  readiness, security checks, 20/20 authenticated requests, and browser smoke.
  GitHub Actions also passed the Docker production workflow for this release:
  [run 36940102511](https://github.com/SriVarshini09/self-healing-api/actions/runs/36940102511).
- The Render Blueprint workflow also passed official schema validation for
  this release:
  [run 36939362667](https://github.com/SriVarshini09/self-healing-api/actions/runs/36939362667).
- The hosted Blueprint now derives the API's CORS origin from Render's public
  dashboard URL, uses the dashboard's same-origin `/api/v1` proxy, and gates
  both web-service deploys on passing GitHub checks. This removes a fragile
  manual URL-copy step while keeping the private service connection explicit.
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
  production configuration when a URL is supplied without a secret. A stale
  `PROCESSING` delivery is reclaimed after a five-minute lease, requeued while
  attempts remain, or marked failed at the configured attempt limit; the status
  endpoint now exposes the processing count.
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
- The production command center now counts healing activity, incident context,
  command search, and intervention rows from active incidents only; resolved
  and dismissed history no longer appears as live healing work.
- The production command center now reads the tenant-scoped alert outbox and
  shows pending, processing, retrying, delivered, and failed delivery counts
  from the real `/alerts/status` endpoint; alert-status failure does not hide
  the core incident view. Dashboard smoke now checks the alert-delivery panel,
  and security smoke validates the full response shape.
- A guarded demo mapping command now validates exact source preconditions and
  required checks before configuring the reviewed Stripe predicate targets. It
  can now also configure the exact demo provisioning adapter target, requiring
  both `verify` and `business-outcome` checks.
- The invariant mapping API now enforces that same `business-outcome` check for
  the reviewed provisioning adapter, so dashboard edits cannot accidentally
  downgrade it to generic-CI-only verification.
- The rebuilt local Docker API rejected a live attempt to downgrade that adapter
  to `verify`-only with HTTP 400 and preserved the stored `verify` plus
  `business-outcome` checks.
- The repair-readiness release audit now independently blocks the reviewed
  provisioning adapter when its exact `business-outcome` check is missing,
  including a distinct machine-readable state.
- A read-only repair-readiness audit now reports every tenant invariant as
  manual review, blocked for missing required checks, or ready for target
  review. It supports human-readable and JSON output plus a fail-on-unready
  mode for release and onboarding checks.
- The production readiness gate and guarded deploy wrappers can now include
  that audit, with an explicit stricter mode that fails when any invariant is
  not ready for automatic repair review.
- The guarded deployment command now forwards the optional dashboard and
  sustained-capacity gates, allowing one release command to run the complete
  local readiness suite.
- A separate `scripts/hosted-readiness.ps1` gate now runs the same checks
  against public HTTPS API/dashboard URLs without starting or mutating a local
  Compose stack. It rejects localhost endpoints, keeps the hosted operator
  key in an external env file, and always prints the read-only repair readiness
  audit. The audit remains informational unless the operator opts into
  `-RequireRepairTargets`.
- A `scripts/bootstrap-hosted-tenant.ps1` helper now creates the first hosted
  tenant from an external bootstrap-token env file, prints the one-time owner
  key without persisting it, and supports a no-request dry run.
- On 2026-10-01, the rebuilt Docker stack at `2373b8a` passed the complete
  readiness suite:
  GitHub App readiness, security smoke, authenticated load (20/20 HTTP 200),
  dashboard browser smoke, and paced sustained capacity (39/39 HTTP 200 with
  a 0% error rate).
- The production API now drains on `SIGTERM`/`SIGINT`, stops the evaluator,
  disconnects Prisma, and logs shutdown failures. Production Compose services
  now use restart policies, init/signal forwarding, bounded stop grace periods,
  and an explicit readiness healthcheck.
- The production backend image now runs as the non-root `node` user, and the
  Docker production workflow asserts the live backend UID is not 0.
- Production metrics are now fail-closed: `/metrics` returns 404 unless the
  deployment supplies the secret `METRICS_TOKEN` and the caller presents it
  through a dedicated header or Bearer token. The security smoke covers the
  unauthenticated case.
- Release smoke checks now retry API, database, and dashboard endpoints during
  a bounded startup window. This prevents a transient container restart race
  from producing a false production-readiness failure; the full local gate
  passed with the retry parameters enabled.
- Production readiness and deploy commands now preflight dotenv syntax and
  duplicate variable names without printing secret values, so malformed
  pasted private-key/base64 lines fail with a safe line-number diagnostic.
- Hosted readiness now sends a harmless signed GitHub `ping` twice and requires
  the second delivery to be acknowledged as a duplicate, making public webhook
  signature and retry-deduplication verification repeatable.

## Not complete

1. **Production GitHub App deployment.** The local stack now has a real App
   installation, repository permissions, a public webhook URL, and a verified
   `200` delivery. A provider-specific Render Blueprint is now committed for
   the API, dashboard, and PostgreSQL. The connected Render workspace was
   inspected read-only on 2026-10-02: it contains unrelated services but no
   SHAPI services or Postgres database. Production rollout still needs the
   Blueprint applied to the intended workspace, secure secret entry, hosted
   tenant-isolated onboarding, and running the hosted signed-webhook smoke
   against that URL. No external Render resources were created or modified.
2. **Repository-aware repair workflow.** Invariants can now store an explicit
   `repairRepository` and `repairFilePath`, and a structured predicate edit
   is generated only for a mapped target. Three reviewed Stripe predicate
   invariants are mapped to the demo repository and require `verify`; the
   provisioning invariant now has a reviewed demo adapter target and requires
   both `verify` and `business-outcome`. The two reviewed GitHub invariants now
   map to their predicate source and require `verify`; most other repair types
   are suggestions only. The
   API supports a read-only patch preview, and the production dashboard
   displays its pinned source excerpts before a PR can be opened. The
   dashboard also edits and saves the explicit repository/file mapping.
3. **End-to-end repair proof.** The provisioning invariant now generates a
   structured patch only for the exact reviewed demo-SaaS target and requires
   the target `business-outcome` check in addition to generic CI; the API also
   rejects mappings that omit that check. This is still
   not a generic sandbox for arbitrary customer repositories. Each customer
   target still needs its own reviewed adapter and full test command. Replay
   still tests a user-entered event transformation, and PR #4 remains open for
   human review; CI evidence is not the same as proving the business outcome
   in production.
4. **Production operations.** Public deployment, secure secret storage,
   hosted tenant onboarding, and hosted sustained capacity/load testing remain
   to be completed before a production launch. Backup/restore, security, and
   bounded local load drills are now repeatable; the local sustained profile
   passed and the rate-limit boundary has been observed under stress. Secure
   secret storage, public deployment, and hosted capacity still require a real
   hosting environment; the hosted readiness command now includes the signed
   webhook and retry-deduplication check.
5. **Dashboard data fidelity.** The production command view now uses only live
   SHAPI incidents, shows exact active/severity/integration/invariant counts,
   and avoids presenting invented regions, map coordinates, correlation
   confidence, availability percentages, request rates, or sample incidents as
   telemetry. Geographic regional telemetry is intentionally not shown because
   SHAPI does not collect location data yet. CI now builds both the legacy
   workspace dashboard and the production `dashboard/` app.

## Next engineering priority

Extend the target-app business-outcome harness beyond its current demo adapter
before claiming arbitrary repository repairs are verified. The next release
blocker is still applying the hosted Blueprint with secure secrets and
tenant-isolated onboarding; local deployment and readiness gates are now
repeatable. Do not claim a replay-verified fix prematurely.

## Local checks

### Latest verification snapshot

Verified locally on 2026-10-02 against the live Docker stack rebuilt from the
current working tree after `340448c` (documentation synchronized by `4438da7`):

- The full `production-readiness.ps1` gate passed with GitHub App mode enabled:
  API/database/dashboard readiness, security headers and 401/404 behavior,
  20/20 authenticated requests, production dashboard browser smoke, signed
  GitHub webhook replay deduplication, and fail-closed repair audit all passed.
  The audit reported 6/6 ready for target review, 0 manual-review targets, and
  0 blocked for missing required checks or business-outcome proof.
- The dashboard image rebuilt from `d1127e0` passed direct-API and same-origin
  browser smoke, including the corrected incident headings, live telemetry,
  GitHub connection status, connected integrations, repair-review counts, alert
  delivery, repair targets, and diagnosis modal.
- The most recent full production readiness gate passed against the same
  backend runtime: API, database, dashboard, GitHub App mode, security, 20
  authenticated requests with 0 errors, signed webhook replay, dashboard
  browser smoke, and repair-readiness audit.
- The live Docker stack passed the readiness gate after the reviewed GitHub
  target mappings with 20/20 authenticated requests, dashboard browser smoke,
  and the audit reporting 6/6 ready, 0 explicit `MANUAL_REVIEW`, and 0 blocked
  for missing checks.
- The live incidents API returned `requiredChecks: ["verify"]` for persisted
  repair candidates, including both manual-review and PR-ready candidates.
- Production dashboard smoke passed for the direct API, same-origin proxy,
  command center, live telemetry, connection setup view, webhook URL request,
  recent delivery history and webhook-events request, repair-review queue, all
  five alert-delivery states, readiness summary and states, repair targets, and
  diagnosis modal.
- The dashboard smoke also matched the displayed repair-review totals to the
  live API snapshot after the queue hardening change.
- The signed GitHub webhook smoke passed against the live Docker API: the first
  `ping` delivery returned 200 and replaying the same delivery id returned a
  duplicate acknowledgment.
- Repair readiness audit reported 6/6 ready for target review, 0 manual-review
  targets, and 0 blocked for missing checks.
- The authenticated invariants API now reports six `READY_FOR_TARGET_REVIEW`
  states with the exact `verify` check configured for the two GitHub targets.
- The guarded backup/restore drill passed against the live Docker PostgreSQL
  instance: it created a temporary database, restored the SQL backup, matched
  the key table row counts to the live database, and removed the temporary
  database and backup artifacts.
- Workspace tests passed: 21 backend test files and 120 backend tests; the
  repair-generation package suite includes the structured business-outcome
  proof and real demo adapter proof.
- The full workspace verification passed locally on 2026-10-02: all workspace
  typechecks, tests, and builds passed. The demo HTTP E2E passed the
  failure-to-recovery business-outcome flow, including HTTP 200 on the failed
  webhook and successful provisioning after recovery.
- After rebuilding the live Docker stack from `471359f`, production readiness
  passed again: API/database/dashboard health, security smoke, 100/100
  authenticated requests, dashboard browser smoke, signed GitHub webhook
  replay deduplication, and repair-readiness audit all passed. The audit
  remained 4/6 ready, with 2 explicit GitHub `MANUAL_REVIEW` invariants and
  0 blocked targets.
- The semantic nested-payload regression was also included in the succeeding
  all-workspace CI and Docker validation for `fd1c1f9`.
- The GitHub CI workflow now executes the same all-workspace build and test
  coverage; the follow-up documentation commit passed in [CI run 36966010061](https://github.com/SriVarshini09/self-healing-api/actions/runs/36966010061).
- GitHub Actions CI run `36961198358` and Docker production run
  `36961198357` both passed; Render Blueprint validation run
  `36954469954` also passed.
- The latest business-outcome HTTP E2E and full CI verification passed in run
  `36963752573`; the Docker workflow rebuilt the images and passed production
  readiness in run `36963752517`.
- The bounded sustained-capacity profile passed with 275 authenticated
  requests over 30 seconds at concurrency 1 plus a 100 ms delay: 0.000% error
  rate, 9.2 requests/second, p50 3.7 ms, p95 5.4 ms, and maximum 33.9 ms.
- A deliberate high-concurrency stress profile produced `429` responses rather
  than server errors (978 successful responses and 215,911 rate-limited
  responses), confirming that the configured API rate limiter is enforcing a
  protection boundary. That profile is not a sustainable-capacity pass and
  was not counted as one.

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
