# Security

SHAPI checks that every paying customer actually got what they paid for. To do
that it reads from your database and your Stripe account. This page says exactly
what it can see, what it stores, and how. The dashboard shows the same facts,
including this instance's live settings, at **Security** (`#/security`), which
can be read before signing up.

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/SriVarshini09/self-healing-api/security/advisories/new)
rather than a public issue. Include steps to reproduce and the impact you see.

## Your database

An outcome check is one `SELECT` that returns a row only when a customer was
provisioned. The [query runner](packages/outcome-checks/src/runner.ts) enforces:

- **Only whether a row exists leaves your database.** The query is wrapped as
  `SELECT 1 FROM (your query) AS shapi_outcome LIMIT 1`; column values are never
  read. The values SHAPI binds from the Stripe event (for example the customer id)
  are stored with each check result.
- **One read-only statement.** Only a single `SELECT` or `WITH … SELECT` is
  accepted ([sql.ts](packages/outcome-checks/src/sql.ts)). It runs in a
  `READ ONLY` transaction with a 5-second statement timeout and is always rolled
  back.
- **Least privilege is still on you.** Connect with a role that can only `SELECT`
  the tables your checks use. [QUICK-SETUP.md](docs/QUICK-SETUP.md) has the SQL.
- **Encryption in transit.** Add `sslmode=require` to the database URL.

## Network

- **Private addresses are refused.** Hosted SHAPI only connects to databases on
  the public internet. Hosts that resolve to loopback, private, link-local
  (including cloud metadata at `169.254.169.254`), carrier-grade NAT, multicast or
  reserved ranges are refused, as are `host`/`hostaddr` URL overrides and Unix
  sockets ([network.ts](packages/outcome-checks/src/network.ts)). This is checked
  when a check is saved and again before every run. It is on by default when
  `NODE_ENV=production`; `SHAPI_BLOCK_PRIVATE_DATABASE_HOSTS=false` turns it off
  for a SHAPI self-hosted inside your own network.
- **Allowlisting.** The operator publishes SHAPI's outbound IPs with
  `SHAPI_EGRESS_IPS`. They appear in the dashboard and at `GET /api/v1/trust`.

## What SHAPI stores

| Data | How |
| --- | --- |
| Database URLs, Stripe restricted keys, Slack webhook URLs | AES-256-GCM with a random IV per value. Never returned by the API after saving; the dashboard shows only host and database name. Deleting a check deletes its credentials. |
| Stripe webhook signing secrets | In SHAPI's database without field-level encryption. A leaked signing secret lets someone send events *to* SHAPI; it grants no access to your Stripe account. |
| Stripe events sent to SHAPI's webhook | Stored so checks can run and incidents can show what happened. They contain what Stripe sends, which can include customer emails. Kept while the workspace exists; retention settings are planned. |
| Learned Stripe event shapes (change monitor) | Field names and value kinds (string, object, …) per event type, with counts. Never values. |
| Invite requests (public landing page) | The email, name, company and note you submit, used only to contact you about the beta. Ask us and we delete it. |
| Passwords | scrypt (N=16384, r=8, p=1) with a per-password salt. |
| API keys, session tokens | SHA-256 hashes only. Sessions use `HttpOnly`, `SameSite=Lax` cookies (`Secure` in production). |
| Teammate invite links | SHA-256 hash only. A link expires after 7 days, works once, and re-inviting or revoking cancels it. Owners and Admins invite; Viewers can only read. Removing someone signs them out everywhere. |
| Password reset links | SHA-256 hash only. A link expires after an hour, works once, and a newer request cancels older links. A reset signs the account out everywhere. "Forgot password" answers the same whether or not an account exists. |

Every API request is scoped to the caller's workspace.

### Stripe access

SHAPI asks for a **restricted key with read access to Events only**. Live secret
keys (`sk_live_…`) are refused; test-mode secret keys are accepted for trials.

### Encryption keys (operators)

- `SHAPI_ENCRYPTION_KEY` (32+ characters) encrypts stored secrets. If it is unset,
  SHAPI falls back to a key derived from `JWT_SECRET` and logs a warning in
  production. Set it, so that rotating `JWT_SECRET` never makes stored secrets
  unreadable.
- **First time:** set `SHAPI_ENCRYPTION_KEY`. Existing values stay readable through
  the fallback. Then run
  `pnpm --filter @shapi/backend secrets:reencrypt --apply` to move them to the new
  key. Without `--apply` the script only reports counts.
- **Rotation:** put the current key in `SHAPI_ENCRYPTION_KEY_PREVIOUS`
  (comma-separated), set a new `SHAPI_ENCRYPTION_KEY`, run `secrets:reencrypt
  --apply`, then remove the previous key.
- CI runs this whole path against a real database (`e2e:key-rotation`).

## Known gaps

We'd rather list these than have you find them:

- Stripe webhook signing secrets are not field-encrypted (see above).
- No automatic retention or deletion of stored Stripe events yet.
- The private-address check resolves DNS just before connecting. A hostname whose
  DNS changes in the moment between that check and the connection is not caught.
- No third-party audit or SOC 2 report.
