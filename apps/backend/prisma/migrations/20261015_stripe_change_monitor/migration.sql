-- CreateEnum
CREATE TYPE "StripeChangeKind" AS ENUM ('API_VERSION', 'FIELD_REMOVED', 'TYPE_CHANGED');

-- AlterTable
ALTER TABLE "Integration" ADD COLUMN     "providerApiVersion" TEXT;

-- CreateTable
CREATE TABLE "StripeEventShape" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "samples" INTEGER NOT NULL DEFAULT 0,
    "paths" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StripeEventShape_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeChange" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "incidentId" TEXT,
    "kind" "StripeChangeKind" NOT NULL,
    "eventType" TEXT,
    "path" TEXT,
    "before" TEXT,
    "after" TEXT,
    "apiVersion" TEXT,
    "sourceEventId" TEXT,
    "affectedCheckIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StripeEventShape_integrationId_eventType_key" ON "StripeEventShape"("integrationId", "eventType");

-- CreateIndex
CREATE INDEX "StripeChange_integrationId_detectedAt_idx" ON "StripeChange"("integrationId", "detectedAt");

-- CreateIndex
CREATE INDEX "StripeChange_incidentId_idx" ON "StripeChange"("incidentId");

-- AddForeignKey
ALTER TABLE "StripeEventShape" ADD CONSTRAINT "StripeEventShape_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StripeChange" ADD CONSTRAINT "StripeChange_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StripeChange" ADD CONSTRAINT "StripeChange_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

