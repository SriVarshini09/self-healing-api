// @shapi/diagnosis-engine - pure root-cause heuristics (no DB)
export interface DiagnosisInput {
  failureRate: number;
  failedCount: number;
  totalCount: number;
  expectedSuccessRate: number;
  actualSuccessRate: number;
  topFailedEventType?: string;
  drift?: { baselineRate: number; currentRate: number; pValue: number } | null;
  integrationType?: string;
  failedOutcomes?: { count: number; latestType?: string; latestReason?: string } | null;
}

export interface Diagnosis {
  rootCause: string;
  suggestedFix: string;
  confidence: number;
  evidence: string[];
}

export function diagnose(input: DiagnosisInput): Diagnosis {
  if (input.failedOutcomes && input.failedOutcomes.count > 0) {
    const o = input.failedOutcomes;
    return {
      rootCause:
        `${o.count} failed business outcome(s) tracked` +
        (o.latestType ? ` (latest: ${o.latestType}${o.latestReason ? ` — ${o.latestReason}` : ''})` : ''),
      suggestedFix:
        'The HTTP layer succeeded but the business outcome failed. Inspect the provisioning/business-logic path, not the webhook transport.',
      confidence: 0.9,
      evidence: [
        `${o.count} tracked failure(s)`,
        ...(o.latestType ? [`latest=${o.latestType}`] : []),
        ...(o.latestReason ? [`reason=${o.latestReason}`] : []),
      ],
    };
  }
  if (input.failureRate > 0.1 && input.totalCount > 0) {
    return {
      rootCause: `High webhook failure rate (${(input.failureRate * 100).toFixed(1)}%)`,
      suggestedFix: 'Check webhook endpoint availability and retry logic.',
      confidence: 0.8,
      evidence: [`${input.failedCount}/${input.totalCount} webhooks failed`],
    };
  }
  if (input.actualSuccessRate < input.expectedSuccessRate * 0.8) {
    return {
      rootCause: `Success rate ${(input.actualSuccessRate * 100).toFixed(1)}% below expected ${(input.expectedSuccessRate * 100).toFixed(1)}%`,
      suggestedFix: 'Review predicate logic; third-party API behavior may have changed.',
      confidence: 0.85,
      evidence: [`expected=${input.expectedSuccessRate} actual=${input.actualSuccessRate}`],
    };
  }
  if (input.topFailedEventType) {
    return {
      rootCause: `Failures concentrated in ${input.topFailedEventType}`,
      suggestedFix: `Investigate ${input.topFailedEventType} handling and payload shape.`,
      confidence: 0.7,
      evidence: [`topFailed=${input.topFailedEventType}`],
    };
  }
  if (input.drift) {
    return {
      rootCause: `Statistical drift ${(input.drift.baselineRate * 100).toFixed(1)}% -> ${(input.drift.currentRate * 100).toFixed(1)}% (p=${input.drift.pValue.toFixed(4)})`,
      suggestedFix: 'Review recent integration or API changes; consider updating predicate.',
      confidence: 0.9,
      evidence: ['drift detected'],
    };
  }
  return {
    rootCause: 'Invariant violation without clear pattern',
    suggestedFix: 'Manually review recent events and predicate.',
    confidence: 0.4,
    evidence: [],
  };
}
