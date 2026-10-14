-- CreateEnum
CREATE TYPE "AlertDestinationKind" AS ENUM ('SLACK', 'EMAIL');

-- CreateTable
CREATE TABLE "AlertDestination" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "AlertDestinationKind" NOT NULL,
    "name" TEXT NOT NULL,
    "slackUrlCipher" TEXT,
    "emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyResolved" BOOLEAN NOT NULL DEFAULT true,
    "lastDeliveredAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertDestination_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlertDestination_tenantId_idx" ON "AlertDestination"("tenantId");

-- AddForeignKey
ALTER TABLE "AlertDestination" ADD CONSTRAINT "AlertDestination_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

