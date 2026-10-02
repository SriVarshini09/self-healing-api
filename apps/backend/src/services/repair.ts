import type { Incident, Integration, Invariant, Prisma } from '@prisma/client';
import {
  DEMO_SAAS_PROVISIONING_AFTER,
  DEMO_SAAS_PROVISIONING_BEFORE,
  DEMO_SAAS_PROVISIONING_PATH,
  DEMO_SAAS_REPOSITORY,
  isDemoSaasProvisioningTarget,
  optionalChainPayloadAccess,
  reviewedBusinessOutcomeAdapter,
} from '@shapi/repair-generation';
import type { DiagnosisResult } from './diagnosis.js';

export interface RepairCandidate {
  type: 'CODE_CHANGE' | 'CONFIG_CHANGE' | 'WEBHOOK_RETRY' | 'MANUAL';
  description: string;
  diff: string | null;
  files: string[];
  repository?: string | null;
  confidence: number;
  /** structured changes, persisted to RepairCandidate.changes as JSON; diff/files stay as-is */
  changes?: Prisma.JsonValue | null;
}

export type RepairReviewStatus = 'PR_READY_AFTER_REVIEW' | 'MANUAL_REVIEW';

export interface RepairCandidateReadiness {
  reviewStatus: RepairReviewStatus;
  automationEligible: boolean;
  reviewReason: string;
  requiredChecks: string[];
}

/**
 * Describes whether a candidate has enough explicit information to enter the
 * reviewed PR workflow. Suggestions without a mapped repository, structured
 * changes, or required target checks must remain manual-review work.
 */
export function repairCandidateReadiness(
  candidate: Pick<RepairCandidate, 'repository' | 'changes'> & { files?: readonly string[] },
  requiredChecksInput: readonly string[] = [],
): RepairCandidateReadiness {
  const requiredChecks = [...new Set(requiredChecksInput.map(check => check.trim()).filter(Boolean))];

  if (!candidate.repository) {
    return {
      reviewStatus: 'MANUAL_REVIEW',
      automationEligible: false,
      reviewReason: 'No repository mapping is configured',
      requiredChecks,
    };
  }

  if (!Array.isArray(candidate.changes) || candidate.changes.length === 0) {
    return {
      reviewStatus: 'MANUAL_REVIEW',
      automationEligible: false,
      reviewReason: 'No structured file changes are available',
      requiredChecks,
    };
  }

  if (!requiredChecks.some(check => check.trim().length > 0)) {
    return {
      reviewStatus: 'MANUAL_REVIEW',
      automationEligible: false,
      reviewReason: 'No required GitHub checks are configured',
      requiredChecks,
    };
  }

  const adapter = candidate.repository && candidate.files
    ? candidate.files.map(filePath => reviewedBusinessOutcomeAdapter(candidate.repository, filePath)).find(Boolean) ?? null
    : null;
  if (adapter && !requiredChecks.includes(adapter.requiredCheck)) {
    return {
      reviewStatus: 'MANUAL_REVIEW',
      automationEligible: false,
      reviewReason: `The reviewed ${adapter.adapterId} adapter requires the ${adapter.requiredCheck} check`,
      requiredChecks,
    };
  }

  return {
    reviewStatus: 'PR_READY_AFTER_REVIEW',
    automationEligible: true,
    reviewReason: 'Structured patch, repository mapping, and required checks are configured',
    requiredChecks,
  };
}

type RepairIntegration = Pick<Integration, 'name' | 'type' | 'config'>;
type IncidentWithRelations = Incident & { invariant: Invariant | null; integration: RepairIntegration };

export async function generateRepairCandidates(
  incident: IncidentWithRelations,
  diagnosis: DiagnosisResult,
): Promise<RepairCandidate[]> {
  const candidates: RepairCandidate[] = [];
  const { invariant, integration } = incident;

  if (!invariant) {
    return [
      {
        type: 'MANUAL',
        description: 'No invariant associated - manual investigation required',
        diff: null,
        files: [],
        confidence: 0.1,
      },
    ];
  }

  const businessOutcomeFix = generateDemoSaasBusinessOutcomeFix(invariant);
  if (businessOutcomeFix) candidates.push(businessOutcomeFix);

  const predicateFix = generatePredicateFix(invariant, diagnosis);
  if (predicateFix) candidates.push(predicateFix);

  const retryFix = generateRetryFix(integration);
  if (retryFix) candidates.push(retryFix);

  const configFix = generateConfigFix(integration, diagnosis);
  if (configFix) candidates.push(configFix);

  const codeFix = generateCodeFix(integration, diagnosis);
  if (codeFix) candidates.push(codeFix);

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

function generateDemoSaasBusinessOutcomeFix(invariant: Invariant): RepairCandidate | null {
  if (invariant.id !== 'inv-stripe-provisioning') return null;
  if (!isDemoSaasProvisioningTarget(invariant.repairRepository, invariant.repairFilePath)) {
    return null;
  }

  return {
    type: 'CODE_CHANGE',
    description: 'Remove the reviewed silent provisioning failure branch',
    diff: `- ${DEMO_SAAS_PROVISIONING_BEFORE.trimEnd().replace(/\n/gu, '\n- ')}\n+ ${DEMO_SAAS_PROVISIONING_AFTER.trimEnd().replace(/\n/gu, '\n+ ')}`,
    files: [DEMO_SAAS_PROVISIONING_PATH],
    repository: DEMO_SAAS_REPOSITORY,
    confidence: 0.95,
    changes: [{
      kind: 'replace',
      path: DEMO_SAAS_PROVISIONING_PATH,
      before: DEMO_SAAS_PROVISIONING_BEFORE,
      after: DEMO_SAAS_PROVISIONING_AFTER,
    }],
  };
}

function generatePredicateFix(
  invariant: Invariant,
  _diagnosis: DiagnosisResult,
): RepairCandidate | null {
  const predicate = invariant.predicateExpression;
  const mappedPath = invariant.repairRepository && invariant.repairFilePath
    ? invariant.repairFilePath : null;

  const modified = optionalChainPayloadAccess(predicate);
  if (modified !== predicate) {
    return {
      type: 'CODE_CHANGE',
      description: 'Add optional chaining to predicate to handle missing fields',
      diff: `- ${predicate}\n+ ${modified}`,
      files: mappedPath ? [mappedPath] : [],
      repository: mappedPath ? invariant.repairRepository : null,
      confidence: 0.7,
      ...(mappedPath ? { changes: [{ kind: 'replace', path: mappedPath, before: predicate, after: modified }] } : {}),
    };
  }

  if (!predicate.includes('event.type')) {
    const modified = `event.type !== undefined && (${predicate})`;
    return {
      type: 'CODE_CHANGE',
      description: 'Add event type guard to predicate',
      diff: `- ${predicate}\n+ ${modified}`,
      files: mappedPath ? [mappedPath] : [],
      repository: mappedPath ? invariant.repairRepository : null,
      confidence: 0.5,
      ...(mappedPath ? { changes: [{ kind: 'replace', path: mappedPath, before: predicate, after: modified }] } : {}),
    };
  }

  return null;
}

function generateRetryFix(integration: RepairIntegration): RepairCandidate | null {
  const config = (integration?.config ?? {}) as Record<string, unknown>;
  const hasRetryConfig =
    config.retryAttempts !== undefined || config.retryDelay !== undefined;
  if (!hasRetryConfig) {
    return {
      type: 'CONFIG_CHANGE',
      description: 'Add webhook retry configuration with exponential backoff',
      diff: `+ "retryAttempts": 3\n+ "retryDelay": 1000\n+ "retryBackoff": "exponential"`,
      files: [`integrations/${integration?.name ?? 'unknown'}/config.json`],
      confidence: 0.8,
    };
  }
  return null;
}

function generateConfigFix(integration: RepairIntegration, diagnosis: DiagnosisResult): RepairCandidate | null {
  if (
    diagnosis.rootCause.includes('webhook') ||
    diagnosis.rootCause.includes('timeout')
  ) {
    return {
      type: 'CONFIG_CHANGE',
      description: 'Increase webhook timeout and add circuit breaker',
      diff: `+ "webhookTimeout": 30000\n+ "circuitBreaker": { "threshold": 5, "timeout": 60000 }`,
      files: [`integrations/${integration?.name ?? 'unknown'}/config.json`],
      confidence: 0.75,
    };
  }

  if (integration?.type === 'STRIPE') {
    return {
      type: 'CONFIG_CHANGE',
      description: 'Configure Stripe webhook retry policy and idempotency',
      diff: `+ "stripe": { "webhookRetryPolicy": "exponential", "idempotencyKey": true }`,
      files: [`integrations/${integration?.name ?? 'unknown'}/config.json`],
      confidence: 0.7,
    };
  }

  return null;
}

function generateCodeFix(
  integration: RepairIntegration,
  diagnosis: DiagnosisResult,
): RepairCandidate | null {
  if (diagnosis.suggestedFix.includes('event handling')) {
    const safeType = String(integration?.type ?? 'custom').toLowerCase();
    return {
      type: 'CODE_CHANGE',
      description: 'Add handling for new event type in webhook processor',
      diff: `+ // Auto-generated handler for ${safeType}`,
      files: [`src/webhooks/${safeType}/handlers.ts`],
      confidence: 0.6,
    };
  }

  return null;
}
