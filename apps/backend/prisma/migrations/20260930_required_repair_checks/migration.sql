-- Optional names of target-repository checks that must pass before a repair is verified.
ALTER TABLE "Invariant"
  ADD COLUMN "repairRequiredChecks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
