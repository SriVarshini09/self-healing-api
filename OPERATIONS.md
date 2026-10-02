# SHAPI production operator runbook

This runbook covers the hosted launch path. It assumes the repository's
required GitHub checks are green and that the operator has access to the Render
workspace, the identity provider, and the SHAPI GitHub App.

## 1. Apply the hosted infrastructure

1. In Render, apply `render.yaml` from the intended repository and workspace.
2. Keep the generated PostgreSQL connection string and `JWT_SECRET` managed by
   Render. Do not copy either value into Git or a local `.env` file.
3. Enter every `sync: false` value in the Render secret manager. At minimum:
   `SHAPI_BOOTSTRAP_TOKEN`, `METRICS_TOKEN`, `GITHUB_APP_ID`, exactly one GitHub
   private-key source, `GITHUB_APP_SLUG`, `GITHUB_WEBHOOK_SECRET_APP`, and the
   OIDC values when OIDC login is enabled.
4. Use the API service's public hostname as the OIDC redirect host:
   `https://<api-host>/api/v1/auth/callback`.
5. Deploy both web services and wait for `/ready` on the API and `/health` on
   the dashboard.

Before creating a tenant or handling any tenant credential, verify the public
infrastructure, TLS-facing security headers, CORS policy, unauthenticated
rejection, dashboard proxy, and non-cacheable runtime configuration:

```powershell
./scripts/hosted-infrastructure-smoke.ps1 `
  -ApiUrl https://<api-host> `
  -DashboardUrl https://<dashboard-host>
```

This first-stage smoke is intentionally secret-free. It does not replace the
authenticated hosted release gate in section 4.

The private-key source must be exactly one of `GITHUB_APP_PRIVATE_KEY_B64`,
`GITHUB_APP_PRIVATE_KEY_FILE`, or `GITHUB_APP_PRIVATE_KEY`. Base64 is the
recommended hosted form because it is one line and avoids PEM newline damage.

## 2. Configure GitHub App delivery

Install the SHAPI GitHub App on each repository it may repair. Grant Contents
read/write, Pull requests read/write, Checks read-only, and Metadata read-only.
Set the App webhook URL to:

```text
https://<api-host>/api/v1/github/webhook
```

Use the same webhook secret in GitHub and `GITHUB_WEBHOOK_SECRET_APP`. The
`GITHUB_APP_INTEGRATION_ID` value is the SHAPI integration row identifier only
when an initial installation/bootstrap delivery arrives before the installation
has been synchronized; it is not the GitHub App name or slug. Leave it empty
unless the setup instructions for the tenant provide that integration ID.

## 3. Bootstrap the first tenant once

Create a temporary operator file outside the repository, for example
`hosted-bootstrap.env`, containing only:

```dotenv
SHAPI_BOOTSTRAP_TOKEN=<the temporary Render secret>
```

From a trusted PowerShell session in the repository:

```powershell
./scripts/bootstrap-hosted-tenant.ps1 `
  -ApiUrl https://<api-host> `
  -EnvFile ./hosted-bootstrap.env `
  -TenantName "Production" `
  -Slug production `
  -ApiKeyOutputFile C:\secure\shapi-owner.env `
  -DashboardApiKeyOutputFile C:\secure\shapi-dashboard.env
```

The first output file contains the one-time owner API key and the second
contains a separate `OPERATOR` key with only `read` and `write` permissions.
Neither raw key is printed. Keep both files outside the repository and copy
only the dashboard key into `VITE_SHAPI_API_KEY`. For a real production
deployment, configure OIDC instead so no API key is embedded in browser
runtime configuration. If
`-ApiKeyOutputFile` is omitted, the script prints the key for backward
compatibility. Then remove the temporary operator file, rotate or remove
`SHAPI_BOOTSTRAP_TOKEN` in Render, and restart the API if the secret changed.

## 4. Run the hosted release gate

Create a second temporary operator file outside the repository with the
readiness credentials, including `SHAPI_API_KEY` and
`GITHUB_WEBHOOK_SECRET_APP`. Run:

```powershell
./scripts/hosted-readiness.ps1 `
  -ApiUrl https://<api-host> `
  -DashboardUrl https://<dashboard-host> `
  -EnvFile ./hosted-operator.env `
  -IncludeCapacitySmoke `
  -DurationSeconds 60 `
  -CapacityConcurrency 1 `
  -CapacityDelayMs 250 `
  -MaxErrorRate 0 `
  -RequireRepairTargets
```

Before the public gate, validate the operator file without printing any secret
values:

```powershell
./scripts/validate-hosted-env.ps1 -EnvFile ./hosted-operator.env -RequireGitHubApp
```

Add `-RequireOidc` when the dashboard is configured for OIDC-only login. The
preflight rejects placeholder values, partial OIDC configuration, multiple
GitHub private-key sources, and mismatched alert-webhook configuration.

The gate refuses localhost and non-HTTPS URLs. It checks API/database
readiness, security headers and unauthenticated rejection, authenticated load,
GitHub App mode, the live dashboard, signed webhook delivery plus replay
deduplication, and repair-target readiness. A production release should stop if
any check fails or if the audit reports a manual-review or blocked target that
the release owner has not explicitly accepted.

For a repeatable hosted check, configure the repository Actions secrets
`SHAPI_API_KEY`, `GITHUB_WEBHOOK_SECRET_APP`, `GITHUB_APP_ID`,
`GITHUB_APP_SLUG`, and `GITHUB_APP_PRIVATE_KEY_B64` (plus the OIDC and alert
secrets when those features are enabled), then run the `hosted-readiness`
workflow from the GitHub Actions UI. Supply the public API and dashboard URLs;
the workflow writes an ephemeral operator file on the runner, runs the same
secret-safe preflight and hosted gate, and removes the file when the step exits.
It can optionally require OIDC, require every repair target, and run the
bounded capacity smoke.

## 5. Rollback and recovery

- If a deployment fails readiness, keep the previous Render deploy active and
  inspect the API logs before retrying. Do not expose the dashboard until the
  public readiness gate passes.
- Use Render's deploy history to roll back the API and dashboard to the last
  verified image. Re-run the hosted gate after rollback.
- Do not delete PostgreSQL data during an application rollback. For planned
  database recovery, use the guarded backup/restore drill locally first:

  ```powershell
  ./scripts/deploy-production.ps1 `
    -EnvFile ./path/to/.env `
    -IncludeBackupRestoreDrill `
    -ConfirmDrill
  ```

- Keep the owner API key, bootstrap token, GitHub private key, OIDC secret, and
  webhook secrets in the provider secret manager only. Never paste them into an
  issue, pull request, log, or committed file.

## 6. Evidence to record for a release

Record the commit SHA, Render deploy IDs, hosted-readiness output, GitHub App
delivery ID, and the final repair-readiness summary. CI and local Docker checks
prove the repository and container behavior; only the hosted gate proves the
actual public URLs, provider secrets, tenant onboarding, and public webhook.
