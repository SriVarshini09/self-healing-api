-- CreateEnum
CREATE TYPE "OutcomeRunSource" AS ENUM ('WEBHOOK', 'RECONCILE');

-- CreateEnum
CREATE TYPE "OutcomeRunStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'ERROR');

-- CreateTable
CREATE TABLE "OutcomeCheck" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "triggerEventType" TEXT NOT NULL,
    "sqlQuery" TEXT NOT NULL,
    "paramBindings" JSONB NOT NULL,
    "deadlineSec" INTEGER NOT NULL DEFAULT 300,
    "databaseUrlCipher" TEXT NOT NULL,
    "stripeApiKeyCipher" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastReconciledAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutcomeCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutcomeCheckRun" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "source" "OutcomeRunSource" NOT NULL,
    "params" JSONB NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "OutcomeRunStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "checkedAt" TIMESTAMP(3),
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutcomeCheckRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutcomeCheck_integrationId_idx" ON "OutcomeCheck"("integrationId");

-- CreateIndex
CREATE INDEX "OutcomeCheck_triggerEventType_idx" ON "OutcomeCheck"("triggerEventType");

-- CreateIndex
CREATE INDEX "OutcomeCheckRun_status_dueAt_idx" ON "OutcomeCheckRun"("status", "dueAt");

-- CreateIndex
CREATE INDEX "OutcomeCheckRun_checkId_createdAt_idx" ON "OutcomeCheckRun"("checkId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutcomeCheckRun_checkId_sourceEventId_key" ON "OutcomeCheckRun"("checkId", "sourceEventId");

-- AddForeignKey
ALTER TABLE "OutcomeCheck" ADD CONSTRAINT "OutcomeCheck_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutcomeCheckRun" ADD CONSTRAINT "OutcomeCheckRun_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "OutcomeCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

