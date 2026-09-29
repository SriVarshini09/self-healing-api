-- Baseline for the schema shipped before production hardening.

CREATE TYPE "IntegrationType" AS ENUM ('STRIPE', 'GITHUB', 'SENDGRID', 'TWILIO', 'CUSTOM');
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRYING');
CREATE TYPE "InvariantStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'VIOLATED', 'UNKNOWN');
CREATE TYPE "IncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "IncidentStatus" AS ENUM ('DETECTED', 'TRIAGED', 'REPLAYING', 'REPAIRED', 'RESOLVED', 'DISMISSED');
CREATE TYPE "ReplayJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "ReplayJobResult" AS ENUM ('PASSED', 'FAILED', 'ERROR');
CREATE TYPE "RepairType" AS ENUM ('CODE_CHANGE', 'CONFIG_CHANGE', 'WEBHOOK_RETRY', 'MANUAL');
CREATE TYPE "GitHubPRStatus" AS ENUM ('OPEN', 'MERGED', 'CLOSED', 'DRAFT');

CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "IntegrationType" NOT NULL,
    "config" JSONB NOT NULL,
    "webhookSecret" TEXT,
    "webhookEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "correlationId" TEXT,
    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Invariant" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "predicateExpression" TEXT NOT NULL,
    "predicateDescription" TEXT NOT NULL,
    "predicateExample" TEXT,
    "status" "InvariantStatus" NOT NULL DEFAULT 'UNKNOWN',
    "evaluationWindowSec" INTEGER NOT NULL DEFAULT 300,
    "minSamples" INTEGER NOT NULL DEFAULT 10,
    "expectedSuccessRate" DOUBLE PRECISION NOT NULL DEFAULT 0.99,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastEvaluatedAt" TIMESTAMP(3),
    CONSTRAINT "Invariant_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "InvariantEvaluation" (
    "id" TEXT NOT NULL,
    "invariantId" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "totalSamples" INTEGER NOT NULL,
    "passedSamples" INTEGER NOT NULL,
    "successRate" DOUBLE PRECISION NOT NULL,
    "status" "InvariantStatus" NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvariantEvaluation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "invariantId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'DETECTED',
    "rootCause" TEXT,
    "suggestedFix" TEXT,
    "githubPrUrl" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "triagedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "DriftDetectionConfig" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "baselineWindowDays" INTEGER NOT NULL DEFAULT 30,
    "detectionWindowHours" INTEGER NOT NULL DEFAULT 1,
    "minDetectionSamples" INTEGER NOT NULL DEFAULT 50,
    "significanceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.01,
    "minEffectSize" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DriftDetectionConfig_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "DriftResult" (
    "id" TEXT NOT NULL,
    "invariantId" TEXT NOT NULL,
    "detected" BOOLEAN NOT NULL,
    "pValue" DOUBLE PRECISION NOT NULL,
    "effectSize" DOUBLE PRECISION NOT NULL,
    "baselineRate" DOUBLE PRECISION NOT NULL,
    "currentRate" DOUBLE PRECISION NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DriftResult_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ReplayJob" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "webhookEventId" TEXT NOT NULL,
    "status" "ReplayJobStatus" NOT NULL DEFAULT 'PENDING',
    "fixCandidate" TEXT NOT NULL,
    "result" "ReplayJobResult",
    "originalEvaluation" JSONB,
    "replayEvaluation" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReplayJob_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "RepairCandidate" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "type" "RepairType" NOT NULL,
    "description" TEXT NOT NULL,
    "diff" TEXT,
    "files" TEXT[],
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RepairCandidate_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "GitHubInstallation" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "githubInstallationId" BIGINT NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "repositories" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GitHubInstallation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "GitHubPullRequest" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "repository" TEXT NOT NULL,
    "prNumber" INTEGER NOT NULL,
    "prUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "GitHubPRStatus" NOT NULL DEFAULT 'OPEN',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GitHubPullRequest_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "TrackedEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "integration" "IntegrationType" NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlationId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackedEvent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "APIKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "permissions" TEXT[],
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "APIKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Integration_webhookSecret_key" ON "Integration"("webhookSecret");
CREATE INDEX "Integration_type_idx" ON "Integration"("type");
CREATE INDEX "WebhookEvent_integrationId_receivedAt_idx" ON "WebhookEvent"("integrationId", "receivedAt");
CREATE INDEX "WebhookEvent_correlationId_idx" ON "WebhookEvent"("correlationId");
CREATE INDEX "WebhookEvent_status_idx" ON "WebhookEvent"("status");
CREATE INDEX "Invariant_integrationId_idx" ON "Invariant"("integrationId");
CREATE INDEX "Invariant_status_idx" ON "Invariant"("status");
CREATE INDEX "InvariantEvaluation_invariantId_windowStart_idx" ON "InvariantEvaluation"("invariantId", "windowStart");
CREATE UNIQUE INDEX "InvariantEvaluation_invariantId_windowStart_windowEnd_key" ON "InvariantEvaluation"("invariantId", "windowStart", "windowEnd");
CREATE INDEX "Incident_integrationId_status_idx" ON "Incident"("integrationId", "status");
CREATE INDEX "Incident_invariantId_idx" ON "Incident"("invariantId");
CREATE INDEX "Incident_detectedAt_idx" ON "Incident"("detectedAt");
CREATE UNIQUE INDEX "DriftDetectionConfig_integrationId_key" ON "DriftDetectionConfig"("integrationId");
CREATE INDEX "DriftResult_invariantId_detectedAt_idx" ON "DriftResult"("invariantId", "detectedAt");
CREATE INDEX "DriftResult_detected_idx" ON "DriftResult"("detected");
CREATE INDEX "ReplayJob_incidentId_idx" ON "ReplayJob"("incidentId");
CREATE INDEX "ReplayJob_status_idx" ON "ReplayJob"("status");
CREATE INDEX "RepairCandidate_incidentId_idx" ON "RepairCandidate"("incidentId");
CREATE UNIQUE INDEX "GitHubInstallation_githubInstallationId_key" ON "GitHubInstallation"("githubInstallationId");
CREATE INDEX "GitHubPullRequest_incidentId_idx" ON "GitHubPullRequest"("incidentId");
CREATE UNIQUE INDEX "GitHubPullRequest_installationId_repository_prNumber_key" ON "GitHubPullRequest"("installationId", "repository", "prNumber");
CREATE UNIQUE INDEX "TrackedEvent_eventId_key" ON "TrackedEvent"("eventId");
CREATE INDEX "TrackedEvent_integration_type_timestamp_idx" ON "TrackedEvent"("integration", "type", "timestamp");
CREATE INDEX "TrackedEvent_correlationId_idx" ON "TrackedEvent"("correlationId");
CREATE INDEX "TrackedEvent_timestamp_idx" ON "TrackedEvent"("timestamp");
CREATE UNIQUE INDEX "APIKey_keyHash_key" ON "APIKey"("keyHash");
CREATE INDEX "APIKey_prefix_idx" ON "APIKey"("prefix");

ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invariant" ADD CONSTRAINT "Invariant_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvariantEvaluation" ADD CONSTRAINT "InvariantEvaluation_invariantId_fkey" FOREIGN KEY ("invariantId") REFERENCES "Invariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_invariantId_fkey" FOREIGN KEY ("invariantId") REFERENCES "Invariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DriftDetectionConfig" ADD CONSTRAINT "DriftDetectionConfig_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriftResult" ADD CONSTRAINT "DriftResult_invariantId_fkey" FOREIGN KEY ("invariantId") REFERENCES "Invariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReplayJob" ADD CONSTRAINT "ReplayJob_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReplayJob" ADD CONSTRAINT "ReplayJob_webhookEventId_fkey" FOREIGN KEY ("webhookEventId") REFERENCES "WebhookEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RepairCandidate" ADD CONSTRAINT "RepairCandidate_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubInstallation" ADD CONSTRAINT "GitHubInstallation_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubPullRequest" ADD CONSTRAINT "GitHubPullRequest_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubPullRequest" ADD CONSTRAINT "GitHubPullRequest_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "GitHubInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
