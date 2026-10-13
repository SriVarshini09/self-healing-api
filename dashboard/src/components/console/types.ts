export type Incident = {
  id: string;
  title: string;
  description?: string;
  status: string;
  severity: string;
  integrationId: string;
  detectedAt: string;
  resolvedAt?: string | null;
  rootCause?: string | null;
  suggestedFix?: string | null;
  integration?: { id: string; name: string; type: string };
  invariant?: { id?: string; name: string; predicateDescription?: string; repairRequiredChecks?: string[] } | null;
};

export type RepairCandidate = {
  id: string;
  type: string;
  description: string;
  confidence: number;
  files: string[];
  diff: string | null;
  repository: string | null;
  changes: unknown[] | null;
  reviewStatus: 'PR_READY_AFTER_REVIEW' | 'MANUAL_REVIEW';
  automationEligible: boolean;
  reviewReason: string;
  requiredChecks: string[];
};

export type IncidentDetail = Incident & { repairCandidates?: RepairCandidate[] };

export type TimelineItem = { type: string; timestamp: string; message: string };

export type GitHubInstallation = { id: string; accountLogin: string; repositories: string[] };

export type GitHubPr = {
  id: string;
  prNumber: number;
  repository: string;
  prUrl: string;
  title: string;
  status: string;
  verified: boolean;
  createdAt: string;
};

export type GitHubStatus = {
  mode: 'app' | 'token' | 'simulated' | 'unconfigured';
  message: string;
  webhookConfigured: boolean;
  realInstallations: number;
  repositoryCount: number;
  appInstallUrl: string | null;
};

export type RepairPreview = {
  repository: string;
  base: string;
  baseSha: string;
  previewToken: string;
  changes: Array<{
    path: string;
    kind: 'replace' | 'create';
    before: { text: string; truncated: boolean } | null;
    after: { text: string; truncated: boolean };
  }>;
};

export type Integration = {
  id: string;
  name: string;
  type: string;
  webhookEnabled: boolean;
  webhookSecretConfigured: boolean;
  _count?: { webhookEvents?: number; invariants?: number; incidents?: number };
};

export type Invariant = {
  id: string;
  name: string;
  status: string;
  predicateExpression: string;
  predicateDescription?: string;
  repairRepository: string | null;
  repairFilePath: string | null;
  repairRequiredChecks: string[];
  integration?: { name: string; type: string };
  repairReadiness?: { state: string; reason: string; adapterId?: string | null };
};

export type RunStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'ERROR';

export type OutcomeCheck = {
  id: string;
  integrationId: string;
  name: string;
  triggerEventType: string;
  sql: string;
  paramBindings: Record<string, string>;
  deadlineSec: number;
  database: string;
  stripeConnected: boolean;
  enabled: boolean;
  lastError: string | null;
  runsLast24h?: Record<RunStatus, number>;
};

export type OutcomeRun = {
  id: string;
  sourceEventId: string;
  source: 'WEBHOOK' | 'RECONCILE';
  params: Record<string, unknown>;
  dueAt: string;
  status: RunStatus;
  checkedAt: string | null;
  detail: string | null;
};

export const OPEN_STATUSES = ['DETECTED', 'TRIAGED', 'REPLAYING', 'REPAIRED'];
