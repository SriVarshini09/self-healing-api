CREATE TYPE "AlertDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'RETRYING', 'FAILED');

CREATE TABLE "AlertDelivery" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'webhook',
    "status" "AlertDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "httpStatus" INTEGER,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AlertDelivery_incidentId_channel_key" ON "AlertDelivery"("incidentId", "channel");
CREATE INDEX "AlertDelivery_status_nextAttemptAt_idx" ON "AlertDelivery"("status", "nextAttemptAt");

ALTER TABLE "AlertDelivery" ADD CONSTRAINT "AlertDelivery_incidentId_fkey"
  FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
