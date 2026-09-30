# GitHub repair workflow

SHAPI can turn a replay-verified repair candidate into a GitHub pull request.

## Required configuration

- Configure a GitHub App installation for the tenant and restrict it to approved repositories.
- Set `GITHUB_TOKEN` in production for the Octokit repair and verification calls.
- Configure `GITHUB_WEBHOOK_SECRET_APP` and point the GitHub App webhook at `/api/v1/github/webhook`.

## Operator flow

1. Diagnose an incident and review the repair candidates.
2. Replay the candidate and confirm the result passes.
3. Create the repair PR from the incident panel.
4. SHAPI marks the PR verified only after every check run on the PR head completes successfully.
5. The incident becomes resolved only after GitHub sends a closed-and-merged pull request webhook.

A PR with no check runs is never considered verified. CI failures and incomplete checks fail closed.