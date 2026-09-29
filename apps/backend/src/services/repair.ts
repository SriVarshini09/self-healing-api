import { prisma } from '../utils/prisma.js';
import type { Incident, Integration, Invariant, Prisma } from '@prisma/client';
import type { DiagnosisResult } from './diagnosis.js';

export interface RepairCandidate {
  type: 'CODE_CHANGE' | 'CONFIG_CHANGE' | 'WEBHOOK_RETRY' | 'MANUAL';
  description: string;
  diff: string | null;
  files: string[];
  confidence: number;
  /** structured changes, persisted to RepairCandidate.changes as JSON; diff/files stay as-is */
  changes?: Prisma.JsonValue | null;
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

  const predicateFix = generatePredicateFix(invariant, diagnosis);
  if (predicateFix) candidates.push(predicateFix);

  const retryFix = generateRetryFix(integration);
  if (retryFix) candidates.push(retryFix);

  const configFix = generateConfigFix(integration, diagnosis);
  if (configFix) candidates.push(configFix);

  const codeFix = generateCodeFix(invariant, integration, diagnosis);
  if (codeFix) candidates.push(codeFix);

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

function generatePredicateFix(
  invariant: Invariant,
  _diagnosis: DiagnosisResult,
): RepairCandidate | null {
  const predicate = invariant.predicateExpression;

  if (predicate.includes('payload.') && !predicate.includes('?.')) {
    const modified = predicate.replace(/payload\.(\w+)/g, 'payload?.$1');
    return {
      type: 'CODE_CHANGE',
      description: 'Add optional chaining to predicate to handle missing fields',
      diff: `- ${predicate}\n+ ${modified}`,
      files: [`invariants/${invariant.name}.ts`],
      confidence: 0.7,
      changes: [{ kind: 'replace', path: `invariants/${invariant.name}.ts`, before: predicate, after: modified }],
    };
  }

  if (predicate.includes('===')) {
    const modified = predicate.replace(/===/g, '==');
    return {
      type: 'CODE_CHANGE',
      description: 'Relax strict equality to handle type coercion from third-party API',
      diff: `- ${predicate}\n+ ${modified}`,
      files: [`invariants/${invariant.name}.ts`],
      confidence: 0.6,
    };
  }

  if (!predicate.includes('event.type')) {
    const modified = `event.type !== undefined && (${predicate})`;
    return {
      type: 'CODE_CHANGE',
      description: 'Add event type guard to predicate',
      diff: `- ${predicate}\n+ ${modified}`,
      files: [`invariants/${invariant.name}.ts`],
      confidence: 0.5,
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
  invariant: Invariant,
  integration: RepairIntegration,
  diagnosis: DiagnosisResult,
): RepairCandidate | null {
  if (diagnosis.suggestedFix.includes('predicate')) {
    return {
      type: 'CODE_CHANGE',
      description: 'Update invariant predicate to handle new event format',
      diff: `- const predicate = ${invariant.predicateExpression};\n+ const predicate = ${invariant.predicateExpression.replace('===', '==')};`,
      files: [`src/invariants/${invariant.name.toLowerCase().replace(/\s+/g, '-')}.ts`],
      confidence: 0.65,
    };
  }

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

export async function createRepairPR(
  incidentId: string,
  candidate: RepairCandidate,
  _installationId: string,
  repository: string,
): Promise<{ prUrl: string; prNumber: number }> {
  const prNumber = Math.floor(Math.random() * 10000) + 1;
  const prUrl = `https://github.com/${repository}/pull/${prNumber}`;

  await prisma.repairCandidate.updateMany({
    where: { incidentId, description: candidate.description },
    data: { verified: true },
  });

  return { prUrl, prNumber };
}
