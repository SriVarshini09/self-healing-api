# SHAPI — Product Strategy, Market Research & Roadmap

**Date:** 2026-09-27
**Status:** Local MVP complete and verified (47 tests green, strict lint, CI green, live E2E green)

---

## 1. Where we started vs. what we achieved

### Starting point
- An empty folder and a thesis: **a `200 OK` does not prove success.**
- Third-party integrations (Stripe, GitHub, etc.) can look technically healthy while
  silently failing to produce the expected **business outcome**
  (payment succeeds → user never provisioned).

### What we built (verified working)
| Layer | Status |
|---|---|
| Monorepo (pnpm, 3 apps + 8 packages) | ✅ Done |
| Backend API (Fastify + Prisma + Postgres) | ✅ Done, zero-`any` strict lint |
| Premium dashboard (6-tab ops console) | ✅ Done, live-verified |
| Demo SaaS with simulated silent-provisioning bug | ✅ Done |
| Instrumentation SDK (`track` + `webhookReporter`) | ✅ Done |
| Behavioral invariant engine (vm-sandboxed predicates) | ✅ Done |
| Statistical drift detection (z-test + effect size) | ✅ Done |
| Incident lifecycle (DETECTED → TRIAGED → REPLAYING → REPAIRED → RESOLVED) | ✅ Done |
| Diagnosis engine + repair candidates + replay verification | ✅ Done, live-verified |
| GitHub verified-PR workflow (real Octokit path) | ✅ Done, real PR path fixed |
| CI on `master` (typecheck, tests, build, Prisma) | ✅ Green |
| Full verification: 47 tests, live webhook→incident→diagnose→replay E2E, 25× stress run | ✅ Green |

### The core abstraction (our moat seed)
**Behavioral invariants** — executable predicates over webhook events evaluated over
time windows. Nobody in the market sells *business-outcome assertions* as a primitive.
Everyone else monitors transport (status codes, latency, delivery). We monitor meaning.

---

## 2. Market map (2025–2026)

### Category A — Webhook infrastructure (transport reliability)
| Player | Position | Funding/scale |
|---|---|---|
| **Svix** (Dispatch) | Outbound webhook delivery, 99.99999% uptime, SOC2/HIPAA/PCI | Category leader, Fortune 500 customers |
| **Hookdeck** (Event Gateway + Outpost) | Inbound gateway + outbound delivery, issues tracking, replay | $5.5M raised, billions of events |
| **Convoy** | Open-source delivery server | Company inactive → side project |
| **Hook0, Webhook Relay, Hooklog** | Niche/indie tools | Bootstrapped |

What they solve: *did the webhook get delivered?* What they DON'T solve: *did the
business outcome happen?* Hookdeck opens an "issue" on delivery failure — but a 200
that silently skips provisioning is invisible to all of them.

### Category B — AI incident management / self-healing (response automation)
| Player | Position | Funding |
|---|---|---|
| **incident.io** | AI agents that investigate with you, Scribe notes, auto-remediation | $62M Series B (2025), $96M total |
| **BigPanda, PagerDuty, FireHydrant/Rootly** | Correlation, on-call, response orchestration | Incumbents |
| **Autoheal, Adps AI, HealOps, PlatOps, DataAgent** | Agentic SRE, self-healing infra | Seed/pre-seed wave 2025–2026 ($7–10M rounds) |
| **SRE.ai** | AI-native DevOps for enterprise SaaS (Salesforce-first) | $7.2M, YC + Salesforce Ventures |

What they solve: *respond faster once an alert fires.* What they DON'T solve:
detection of failures that never produce an alert — the silent class.

### Category C — Synthetic/API monitoring (outside-in correctness)
| Player | Position |
|---|---|
| **Checkly** | Monitoring-as-Code, Playwright synthetics, Rocky AI RCA, $20M Series B |
| **Better Stack** | Logs + monitoring + incidents, 200k devs, profitable, $28M+ total |

What they solve: *does the endpoint work right now when probed?* What they DON'T solve:
continuous assertion of real third-party event streams, or closing the loop to a fix PR.

### The gap (our wedge)
Every category stops at the transport/response boundary. **Nobody owns the sentence
"the payment succeeded AND the user was provisioned."** That sentence is SHAPI.

---

## 3. Problem categories we can solve (ranked by pain × willingness to pay)

### P1 — Silent revenue leakage (Stripe/Paddle billing webhooks)
- *Who:* SaaS founders, fintech, e-commerce, indie hackers.
- *Pain:* Paid-but-no-access, canceled-but-still-active, dunning loops. Real reports of
  months of leakage ($12k+ sitting in failed invoices) with green dashboards.
- *Why us:* An invariant like `payment_succeeded ⇒ provisioning.completed within 5 min`
  turns this into a paged incident with a repair PR. Competitors only retry delivery.
- *Evidence:* multiple 2025–2026 public postmortems; Stripe's own docs warn 200-before-work
  is a structural trap.

### P2 — Webhook operations toil (retries, replay, audit)
- *Who:* Platform/backend teams at API-first companies.
- *Pain:* Hand-rolled retry queues, replay-by-hand, no audit trail of what happened
  between "received" and "processed".
- *Why us:* Persistent event history + replay-verified repairs + timeline per incident.
  Compete with Hookdeck on *ops*, beat them on *meaning*.

### P3 — Alert fatigue without business signal
- *Who:* SRE/DevOps drowning in infra alerts.
- *Pain:* 95% of alerts are noise; the one that matters (provisioning silently stopped)
  never fires.
- *Why us:* Invariants generate FEW, HIGH-SIGNAL incidents tied to business outcomes,
  with root cause + confidence attached. Complement (don't replace) PagerDuty/incident.io.

### P4 — Integration drift (third-party API changes)
- *Who:* Teams with many third-party deps (payments, comms, logistics).
- *Pain:* Provider changes a payload shape; predicates/handlers silently mismatch.
- *Why us:* Statistical drift detection (z-test + effect size) catches the slow decay
  before customers do. Nobody in Category A/B does this over business predicates.

### P5 — Compliance / audit trail for money movement
- *Who:* Fintech, healthcare-adjacent SaaS.
- *Pain:* "Prove every charge provisioned correctly" for auditors.
- *Why us:* Every invariant evaluation is persisted; every incident has a timeline +
  verified repair. Long-term enterprise wedge (SOC2/HIPAA later).

---

## 4. How we differ (positioning)

| Competitor claim | SHAPI answer |
|---|---|
| "We never miss a webhook" (Hookdeck) | "We catch the webhooks that arrive fine and still fail you." |
| "99.99999% delivery" (Svix) | Delivery is table stakes; we verify *outcomes*. Partner, don't fight: sit downstream of Svix/Hookdeck. |
| "AI agents resolve incidents with you" (incident.io) | We *create* the incidents they can't see, with diagnosis pre-attached. Integration > competition. |
| "Synthetic monitoring" (Checkly) | Probes simulate users; invariants assert on REAL third-party traffic continuously. |
| "Self-healing infra" (DataAgent/Autoheal) | They heal infrastructure (pods, rollbacks). We heal *business logic* (provisioning, billing) via verified code PRs. |

**One-line positioning:**
> SHAPI is the behavioral assurance layer for third-party integrations — it proves
> the business outcome happened, not just the HTTP 200, and opens a verified fix PR
> when it didn't.

**Strategic notes:**
- Don't out-build Svix/Hookdeck on delivery; **integrate** (ingest from them, add meaning).
- Don't out-agent incident.io; **feed** them (SHAPI incident → their workflow).
- The invariant primitive + persisted evaluations is the defensible data moat:
  every customer run makes drift baselines smarter.

---

## 5. Next steps from here (phased)

### Phase 1 — Prove value on real pain (2–4 weeks)
1. Real Stripe end-to-end (needs Stripe account): `stripe listen` → true HMAC path → invariant flip in dashboard.
2. Real GitHub repair PR (token ready): open + verify + merge one repair PR; screenshot the loop for the story.
3. Dogfood on 1–2 real side projects: point SHAPI at a live Stripe test-mode webhook stream for a week; count caught silent failures.
4. Reseed clean + record a 3-minute demo video (success → failure → incident → diagnose → PR).

### Phase 2 — Harden for others (1–2 months)
5. Multi-tenant auth hardening: per-customer API keys + scopes (exists), rate limits per key, `isolated-vm` sandbox upgrade.
6. Hosted onboarding: one-command Docker Compose + cloud seed; Stripe/GitHub OAuth instead of pasted tokens.
7. Notifications: Slack/email on TRIAGED incidents (currently dashboard-only).
8. Pricing skeleton: free (1 integration) → team ($/events) → enterprise (SSO, audit export).

### Phase 3 — Moat building (3–6 months)
9. Invariant marketplace: pre-built packs (Stripe billing, GitHub CI, SendGrid delivery).
10. Learning baselines: auto-suggest invariants from historical event shapes.
11. Bidirectional integrations: emit to PagerDuty/incident.io; ingest from Hookdeck/Svix.
12. Compliance path: SOC 2 Type II when first enterprise design partner signs.

### Immediate actions (this week)
- [ ] Finish real GitHub PR verification (token → PR → merge)
- [ ] Decide: side-project dogfood vs. direct outreach to 5 SaaS founders with Stripe pain
- [ ] Publish demo video + "200 OK does not prove success" launch post (the phrase is the brand)
