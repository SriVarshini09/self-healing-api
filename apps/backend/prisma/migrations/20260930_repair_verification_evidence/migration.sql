-- Persist the exact GitHub commit and check-run evidence used to verify a repair PR.
ALTER TABLE "GitHubPullRequest"
  ADD COLUMN "verificationHeadSha" TEXT,
  ADD COLUMN "verificationChecks" JSONB,
  ADD COLUMN "verifiedAt" TIMESTAMP(3);
