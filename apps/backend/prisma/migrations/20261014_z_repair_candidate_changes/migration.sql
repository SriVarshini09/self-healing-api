-- RepairCandidate.changes was added to schema.prisma in 474a16b without a migration.
-- IF NOT EXISTS: databases created with `prisma db push` already have it.
ALTER TABLE "RepairCandidate" ADD COLUMN IF NOT EXISTS "changes" JSONB;
