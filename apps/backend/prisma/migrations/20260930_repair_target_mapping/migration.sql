-- Link a behavioral invariant to the repository file containing its predicate.
-- Existing invariants remain unmapped and produce manual-review suggestions.
ALTER TABLE "Invariant"
  ADD COLUMN "repairRepository" TEXT,
  ADD COLUMN "repairFilePath" TEXT;

ALTER TABLE "RepairCandidate"
  ADD COLUMN "repository" TEXT;
