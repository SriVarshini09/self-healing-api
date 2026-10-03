-- Production hardening: tenant ownership and provider webhook idempotency.

CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

ALTER TABLE "Integration" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "TrackedEvent" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "APIKey" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "WebhookEvent" ADD COLUMN "providerEventId" TEXT;

CREATE TYPE "TenantRole" AS ENUM ('OWNER', 'ADMIN', 'OPERATOR', 'VIEWER');
ALTER TABLE "APIKey" ADD COLUMN "role" "TenantRole" NOT NULL DEFAULT 'OPERATOR';

-- Existing single-tenant/demo data remains reachable after the API starts
-- requiring tenant-scoped API keys. Operators can repartition these rows later.
INSERT INTO "Tenant" ("id", "name", "slug", "updatedAt")
VALUES ('tenant-local-dev', 'Local Development', 'local-dev', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

UPDATE "Integration" SET "tenantId" = 'tenant-local-dev' WHERE "tenantId" IS NULL;
UPDATE "TrackedEvent" SET "tenantId" = 'tenant-local-dev' WHERE "tenantId" IS NULL;
UPDATE "APIKey" SET "tenantId" = 'tenant-local-dev' WHERE "tenantId" IS NULL;
UPDATE "APIKey" SET "role" = 'OWNER';

CREATE INDEX "Integration_tenantId_idx" ON "Integration"("tenantId");
CREATE INDEX "TrackedEvent_tenantId_timestamp_idx" ON "TrackedEvent"("tenantId", "timestamp");
CREATE INDEX "APIKey_tenantId_idx" ON "APIKey"("tenantId");
CREATE UNIQUE INDEX "WebhookEvent_integrationId_providerEventId_key"
  ON "WebhookEvent"("integrationId", "providerEventId");

ALTER TABLE "Integration"
  ADD CONSTRAINT "Integration_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TrackedEvent"
  ADD CONSTRAINT "TrackedEvent_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "APIKey"
  ADD CONSTRAINT "APIKey_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
