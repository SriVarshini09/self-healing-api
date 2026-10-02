import { z } from 'zod';

// ============================================================================
// Core Domain Types
// ============================================================================

export const IntegrationTypeSchema = z.enum([
  'stripe',
  'github',
  'sendgrid',
  'twilio',
  'custom'
]);
export type IntegrationType = z.infer<typeof IntegrationTypeSchema>;

export const WebhookEventStatusSchema = z.enum([
  'received',
  'processing',
  'completed',
  'failed',
  'retrying'
]);
export type WebhookEventStatus = z.infer<typeof WebhookEventStatusSchema>;

export const InvariantStatusSchema = z.enum([
  'healthy',
  'degraded',
  'violated',
  'unknown'
]);
export type InvariantStatus = z.infer<typeof InvariantStatusSchema>;

export const IncidentSeveritySchema = z.enum([
  'low',
  'medium',
  'high',
  'critical'
]);
export type IncidentSeverity = z.infer<typeof IncidentSeveritySchema>;

export const IncidentStatusSchema = z.enum([
  'detected',
  'triaged',
  'replaying',
  'repaired',
  'resolved',
  'dismissed'
]);
export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;

// ============================================================================
// Webhook Event
// ============================================================================

export const WebhookEventSchema = z.object({
  id: z.string().uuid(),
  integrationId: z.string().uuid(),
  integrationType: IntegrationTypeSchema,
  eventType: z.string(),
  providerEventId: z.string().nullable().optional(),
  payload: z.record(z.unknown()),
  headers: z.record(z.string()),
  status: WebhookEventStatusSchema,
  receivedAt: z.date(),
  processedAt: z.date().nullable(),
  retryCount: z.number().int().default(0),
  errorMessage: z.string().nullable(),
  correlationId: z.string().nullable()
});
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

// ============================================================================
// Behavioral Invariant
// ============================================================================

export const InvariantPredicateSchema = z.object({
  // TypeScript expression that evaluates to boolean
  expression: z.string(),
  // Human-readable description
  description: z.string(),
  // Example: "event.payload.type === 'invoice.payment_succeeded' && event.payload.amount_paid > 0"
  example: z.string().optional()
});

export const InvariantSchema = z.object({
  id: z.string().uuid(),
  integrationId: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  predicate: InvariantPredicateSchema,
  status: InvariantStatusSchema,
  // Evaluation window in seconds
  evaluationWindowSec: z.number().int().default(300),
  // Minimum samples required for evaluation
  minSamples: z.number().int().default(10),
  // Expected success rate (0-1)
  expectedSuccessRate: z.number().min(0).max(1).default(0.99),
  createdAt: z.date(),
  updatedAt: z.date(),
  lastEvaluatedAt: z.date().nullable()
});
export type Invariant = z.infer<typeof InvariantSchema>;

export const InvariantEvaluationSchema = z.object({
  id: z.string().uuid(),
  invariantId: z.string().uuid(),
  windowStart: z.date(),
  windowEnd: z.date(),
  totalSamples: z.number().int(),
  passedSamples: z.number().int(),
  successRate: z.number().min(0).max(1),
  status: InvariantStatusSchema,
  details: z.record(z.unknown()).optional()
});
export type InvariantEvaluation = z.infer<typeof InvariantEvaluationSchema>;

// ============================================================================
// Integration
// ============================================================================

export const IntegrationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: IntegrationTypeSchema,
  config: z.record(z.unknown()),
  // Webhook secret for verification
  webhookSecret: z.string().nullable(),
  // Whether webhook ingestion is enabled
  webhookEnabled: z.boolean().default(true),
  createdAt: z.date(),
  updatedAt: z.date()
});
export type Integration = z.infer<typeof IntegrationSchema>;

// ============================================================================
// Incident
// ============================================================================

export const IncidentSchema = z.object({
  id: z.string().uuid(),
  integrationId: z.string().uuid(),
  invariantId: z.string().uuid().nullable(),
  title: z.string(),
  description: z.string(),
  severity: IncidentSeveritySchema,
  status: IncidentStatusSchema,
  // Root cause analysis result
  rootCause: z.string().nullable(),
  // Suggested fix
  suggestedFix: z.string().nullable(),
  // GitHub PR URL if created
  githubPrUrl: z.string().url().nullable(),
  detectedAt: z.date(),
  triagedAt: z.date().nullable(),
  resolvedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
export type Incident = z.infer<typeof IncidentSchema>;

// ============================================================================
// Drift Detection
// ============================================================================

export const DriftDetectionConfigSchema = z.object({
  // Baseline window in days
  baselineWindowDays: z.number().int().default(30),
  // Detection window in hours
  detectionWindowHours: z.number().int().default(1),
  // Minimum samples in detection window
  minDetectionSamples: z.number().int().default(50),
  // Significance threshold (p-value)
  significanceThreshold: z.number().min(0).max(1).default(0.01),
  // Minimum effect size (Cohen's d)
  minEffectSize: z.number().default(0.5)
});
export type DriftDetectionConfig = z.infer<typeof DriftDetectionConfigSchema>;

export const DriftResultSchema = z.object({
  invariantId: z.string().uuid(),
  detected: z.boolean(),
  pValue: z.number().min(0).max(1),
  effectSize: z.number(),
  baselineRate: z.number().min(0).max(1),
  currentRate: z.number().min(0).max(1),
  sampleSize: z.number().int(),
  detectedAt: z.date()
});
export type DriftResult = z.infer<typeof DriftResultSchema>;

// ============================================================================
// Replay Engine
// ============================================================================

export const ReplayJobSchema = z.object({
  id: z.string().uuid(),
  incidentId: z.string().uuid(),
  webhookEventId: z.string().uuid(),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  // The fix being tested
  fixCandidate: z.string(),
  // Result of replay
  result: z.enum(['passed', 'failed', 'error']).nullable(),
  // Original invariant evaluation
  originalEvaluation: InvariantEvaluationSchema.nullable(),
  // Replay evaluation
  replayEvaluation: InvariantEvaluationSchema.nullable(),
  startedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  errorMessage: z.string().nullable()
});
export type ReplayJob = z.infer<typeof ReplayJobSchema>;

// ============================================================================
// Repair Generation
// ============================================================================

export const RepairCandidateSchema = z.object({
  id: z.string().uuid(),
  incidentId: z.string().uuid(),
  // Type of repair
  type: z.enum(['code_change', 'config_change', 'webhook_retry', 'manual']),
  // Description of the fix
  description: z.string(),
  // Code diff or config change
  diff: z.string().nullable(),
  // Files to modify
  files: z.array(z.string()),
  // Confidence score (0-1)
  confidence: z.number().min(0).max(1),
  // Whether this has been verified via replay
  verified: z.boolean().default(false),
  repository: z.string().nullable().optional(),
  changes: z.array(z.unknown()).nullable().optional(),
  reviewStatus: z.enum(['PR_READY_AFTER_REVIEW', 'MANUAL_REVIEW']).optional(),
  automationEligible: z.boolean().optional(),
  reviewReason: z.string().optional(),
  createdAt: z.date()
});
export type RepairCandidate = z.infer<typeof RepairCandidateSchema>;

// ============================================================================
// GitHub Integration
// ============================================================================

export const GitHubInstallationSchema = z.object({
  id: z.string().uuid(),
  githubInstallationId: z.number().int(),
  accountLogin: z.string(),
  accountType: z.enum(['User', 'Organization']),
  repositories: z.array(z.string()),
  createdAt: z.date(),
  updatedAt: z.date()
});
export type GitHubInstallation = z.infer<typeof GitHubInstallationSchema>;

export const GitHubPullRequestSchema = z.object({
  id: z.string().uuid(),
  incidentId: z.string().uuid(),
  installationId: z.string().uuid(),
  repository: z.string(),
  prNumber: z.number().int(),
  prUrl: z.string().url(),
  title: z.string(),
  status: z.enum(['open', 'merged', 'closed', 'draft']),
  verified: z.boolean().default(false),
  createdAt: z.date(),
  updatedAt: z.date()
});
export type GitHubPullRequest = z.infer<typeof GitHubPullRequestSchema>;

// ============================================================================
// SDK Types
// ============================================================================

export const SDKConfigSchema = z.object({
  apiKey: z.string(),
  apiUrl: z.string().url().default('http://localhost:3001'),
  environment: z.enum(['development', 'staging', 'production']).default('development'),
  // Enable automatic webhook capture
  captureWebhooks: z.boolean().default(true),
  // Custom invariant definitions
  customInvariants: z.array(InvariantPredicateSchema).default([])
});
export type SDKConfig = z.infer<typeof SDKConfigSchema>;

export const TrackedEventSchema = z.object({
  // Unique event identifier
  eventId: z.string(),
  // Integration that generated this event
  integration: IntegrationTypeSchema,
  // Event type (e.g., 'invoice.payment_succeeded')
  type: z.string(),
  // Full payload
  payload: z.record(z.unknown()),
  // Timestamp
  timestamp: z.date(),
  // Correlation ID for tracing
  correlationId: z.string().optional(),
  // Custom metadata
  metadata: z.record(z.unknown()).optional()
});
export type TrackedEvent = z.infer<typeof TrackedEventSchema>;

// ============================================================================
// API Response Types
// ============================================================================

export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    pagination: z.object({
      page: z.number().int().positive(),
      pageSize: z.number().int().positive(),
      total: z.number().int().nonnegative(),
      totalPages: z.number().int().nonnegative()
    })
  });

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional()
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

// ============================================================================
// Utility Types
// ============================================================================

export type UUID = string & { readonly __brand: unique symbol };
export function uuid(v: string): UUID {
  return v as UUID;
}

export type ISODateString = string & { readonly __brand: unique symbol };
export function isoDate(v: string): ISODateString {
  return v as ISODateString;
}
