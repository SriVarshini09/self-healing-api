import { useEffect, useState } from 'react';
import {
  Bell,
  Check,
  ChevronDown,
  CircleAlert,
  CircleGauge,
  Clock3,
  Command,
  GitBranch,
  Globe2,
  HeartPulse,
  Network,
  Pause,
  Play,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const runtimeConfig =
  (globalThis as { __SHAPI_CONFIG__?: { apiUrl?: string; apiKey?: string } }).__SHAPI_CONFIG__ ??
  {};
const SHAPI_API =
  runtimeConfig.apiUrl ||
  import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' ? '/api/v1' : 'http://localhost:3001/api/v1');
const isLocalhost =
  typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const SHAPI_KEY =
  runtimeConfig.apiKey ||
  import.meta.env.VITE_SHAPI_API_KEY ||
  (isLocalhost ? 'shapi_demo_local_d3v_k3y_9f2c' : '');

type LiveSnapshot = {
  summary: { totalInvariants: number; monitoredIntegrations: number; activeAlerts: number };
  incidents: Array<{
    id: string;
    title: string;
    status: string;
    severity: string;
    integrationId: string;
    detectedAt: string;
    repairCandidates?: Array<{
      reviewStatus?: 'PR_READY_AFTER_REVIEW' | 'MANUAL_REVIEW';
      automationEligible?: boolean;
    }>;
    replayJobs?: Array<{ id: string; status: string; result?: string | null }>;
  }>;
};

type AlertStatus = {
  webhookConfigured: boolean;
  pending: number;
  processing: number;
  retrying: number;
  delivered: number;
  failed: number;
};

type LiveDiagnosis = {
  rootCause: string;
  suggestedFix: string;
  confidence: number;
  evidence: string[];
  candidates: Array<{
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
  }>;
};

type GitHubInstallation = { id: string; accountLogin: string; repositories: string[] };
type GitHubPr = {
  id: string;
  prNumber: number;
  repository: string;
  prUrl: string;
  title: string;
  status: string;
  verified: boolean;
  createdAt: string;
  proof?: {
    headSha: string;
    checksTotal: number;
    checkRuns: Array<{
      name: string;
      status: string | null;
      conclusion: string | null;
      detailsUrl: string | null;
    }>;
    requiredChecks?: string[];
    missingChecks?: string[];
  };
};
type GitHubStatus = {
  mode: 'app' | 'token' | 'simulated' | 'unconfigured';
  message: string;
  appCredentialsConfigured: boolean;
  tokenConfigured: boolean;
  webhookConfigured: boolean;
  realInstallations: number;
  installationCount: number;
  repositoryCount: number;
  appInstallUrl: string | null;
};
type RepairPreview = {
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

async function fetchShapi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${SHAPI_API}/${path}`, {
    ...init,
    credentials: 'include',
    headers: { ...(SHAPI_KEY ? { 'x-api-key': SHAPI_KEY } : {}), ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(
      typeof failure?.error === 'string'
        ? `${response.status}: ${failure.error}`
        : `${response.status} ${path}`
    );
  }
  return response.json() as Promise<T>;
}

function GitHubSetupGuide({ status }: { status: GitHubStatus | null }) {
  if (!status) return null;
  return (
    <div className="mt-4 rounded border border-warning/30 bg-warning/5 p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">Production GitHub App setup</span>
        <span className="font-mono text-[10px] text-warning">
          {status.realInstallations} installed
        </span>
      </div>
      <p className="mt-1 text-muted-foreground">
        {status.mode === 'app'
          ? 'The GitHub App is connected. Confirm repository access here before creating a repair PR.'
          : status.mode === 'token'
          ? 'Operator token mode is active for local testing. Use an installed GitHub App for multi-tenant production access.'
          : 'Configure GitHub credentials before creating real repair PRs.'}
      </p>
      {status.appInstallUrl && (
        <a
          href={status.appInstallUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex text-[10px] font-semibold text-primary hover:underline"
        >
          {status.mode === 'app' ? 'Manage repository access ↗' : 'Install the GitHub App ↗'}
        </a>
      )}
      {status.mode !== 'app' && (
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-[10px] text-muted-foreground">
          <li>
            Set <code className="text-foreground">GITHUB_APP_ID</code> and{' '}
            exactly one private-key source: preferably{' '}
            <code className="text-foreground">GITHUB_APP_PRIVATE_KEY_B64</code> or{' '}
            <code className="text-foreground">GITHUB_APP_PRIVATE_KEY_FILE</code>; the direct{' '}
            <code className="text-foreground">GITHUB_APP_PRIVATE_KEY</code> form is also supported.
          </li>
          <li>
            Install the App on the target repository with Contents and Pull requests read/write
            permissions.
          </li>
          <li>
            Set the App webhook secret and point the webhook to{' '}
            <code className="text-foreground">/api/v1/github/webhook</code>.
          </li>
          <li>
            Refresh this diagnosis until the mode changes to <code className="text-success">app</code>
            .
          </li>
        </ol>
      )}
    </div>
  );
}

type IntegrationSummary = {
  id: string;
  name: string;
  type: string;
  webhookEnabled: boolean;
  webhookSecretConfigured: boolean;
  _count?: { webhookEvents?: number; invariants?: number; incidents?: number };
};

type WebhookSetup = {
  webhookUrl: string;
  webhookSecretConfigured: boolean;
  instructions: string;
};

type WebhookEventSummary = {
  id: string;
  eventType: string;
  providerEventId?: string | null;
  status: string;
  receivedAt: string;
};

function ConnectionsPanel() {
  const [githubStatus, setGithubStatus] = useState<GitHubStatus | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [setupId, setSetupId] = useState<string | null>(null);
  const [setup, setSetup] = useState<WebhookSetup | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [eventsId, setEventsId] = useState<string | null>(null);
  const [events, setEvents] = useState<WebhookEventSummary[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [status, response] = await Promise.all([
        fetchShapi<GitHubStatus>('github/status'),
        fetchShapi<{ data: IntegrationSummary[] }>('integrations?pageSize=100'),
      ]);
      setGithubStatus(status);
      setIntegrations(response.data ?? []);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load connections');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const showSetup = async (integration: IntegrationSummary) => {
    if (setupId === integration.id) {
      setSetupId(null);
      setSetup(null);
      return;
    }
    setSetupId(integration.id);
    setSetup(null);
    setSetupLoading(true);
    try {
      setSetup(await fetchShapi<WebhookSetup>(`integrations/${integration.id}/webhook-url`));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load webhook setup');
    } finally {
      setSetupLoading(false);
    }
  };

  const showEvents = async (integration: IntegrationSummary) => {
    if (eventsId === integration.id) {
      setEventsId(null);
      setEvents([]);
      return;
    }
    setEventsId(integration.id);
    setEvents([]);
    setEventsLoading(true);
    try {
      const response = await fetchShapi<{ data: WebhookEventSummary[] }>(
        `integrations/${integration.id}/webhook-events?pageSize=5`,
      );
      setEvents(response.data ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load recent deliveries');
    } finally {
      setEventsLoading(false);
    }
  };

  return (
    <section id="connections" className="mt-3.5 grid gap-3.5 xl:grid-cols-[1.15fr_1fr]">
      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">GitHub repair connection</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Review the App connection before SHAPI can preview or create a repair PR.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? 'Checking…' : 'Refresh'}
          </Button>
        </div>
        {error ? (
          <p className="mt-3 rounded border border-critical/30 bg-critical/5 p-2 text-[10px] text-critical">
            {error}
          </p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className={`rounded px-2 py-1 font-mono text-[10px] uppercase ${githubStatus?.mode === 'app' ? 'bg-success/15 text-success' : githubStatus?.mode === 'unconfigured' ? 'bg-critical/15 text-critical' : 'bg-warning/15 text-warning'}`}
              >
                {githubStatus?.mode ?? 'checking'}
              </span>
              {githubStatus && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  {githubStatus.repositoryCount} repo{githubStatus.repositoryCount === 1 ? '' : 's'} ·{' '}
                  {githubStatus.realInstallations} installation{githubStatus.realInstallations === 1 ? '' : 's'} · webhook{' '}
                  {githubStatus.webhookConfigured ? 'ready' : 'not configured'}
                </span>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {githubStatus?.message ?? 'Checking GitHub configuration…'}
            </p>
            <GitHubSetupGuide status={githubStatus} />
          </>
        )}
      </div>
      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Connected integrations</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Live provider connections and the behavioral checks attached to each one.
            </p>
          </div>
          <span className="font-mono text-[10px] text-muted-foreground">
            {loading ? '…' : `${integrations.length} total`}
          </span>
        </div>
        {error ? (
          <p className="mt-3 text-[10px] text-critical">Integration data unavailable.</p>
        ) : integrations.length ? (
          <div className="mt-3 divide-y divide-border">
            {integrations.map(integration => (
              <div key={integration.id}>
                <div className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                  <span className={`size-2 rounded-full ${integration.webhookEnabled && integration.webhookSecretConfigured ? 'bg-success' : 'bg-warning'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{integration.name}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {integration.type} · {integration._count?.invariants ?? 0} invariants · {integration._count?.incidents ?? 0} incidents
                    </p>
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {integration.webhookEnabled && integration.webhookSecretConfigured ? 'ready' : 'setup needed'}
                  </span>
                  <div className="flex gap-1.5">
                    <Button variant="outline" size="sm" onClick={() => void showSetup(integration)} disabled={setupLoading && setupId === integration.id}>
                      {setupLoading && setupId === integration.id ? 'Loading…' : setupId === integration.id ? 'Hide setup' : 'Setup'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void showEvents(integration)} disabled={eventsLoading && eventsId === integration.id}>
                      {eventsLoading && eventsId === integration.id ? 'Loading…' : eventsId === integration.id ? 'Hide deliveries' : 'Deliveries'}
                    </Button>
                  </div>
                </div>
                {setupId === integration.id && setup && (
                  <div className="mb-2 rounded border border-border bg-secondary/30 p-2 text-[10px]">
                    <p className="font-semibold">Webhook endpoint</p>
                    <code className="mt-1 block break-all rounded bg-background/70 p-2 font-mono text-[10px] text-primary">
                      {setup.webhookUrl}
                    </code>
                    <p className="mt-2 whitespace-pre-line leading-relaxed text-muted-foreground">
                      {setup.instructions}
                    </p>
                    <p className="mt-2 text-warning">
                      Secret status: {setup.webhookSecretConfigured ? 'configured (value hidden)' : 'not configured'}.
                      Secrets are never displayed in this panel.
                    </p>
                  </div>
                )}
                {eventsId === integration.id && (
                  <div className="mb-2 rounded border border-border bg-secondary/30 p-2 text-[10px]">
                    <p className="font-semibold">Recent deliveries</p>
                    {events.length ? (
                      <div className="mt-1 divide-y divide-border">
                        {events.map(event => (
                          <div key={event.id} className="flex items-center gap-2 py-1.5 first:pt-1 last:pb-1">
                            <span className={`rounded px-1.5 py-0.5 font-mono uppercase ${event.status === 'COMPLETED' ? 'bg-success/15 text-success' : event.status === 'FAILED' ? 'bg-critical/15 text-critical' : 'bg-warning/15 text-warning'}`}>
                              {event.status}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-muted-foreground">
                              {event.eventType}{event.providerEventId ? ` · ${event.providerEventId}` : ''}
                            </span>
                            <time className="shrink-0 font-mono text-muted-foreground" dateTime={event.receivedAt}>
                              {new Date(event.receivedAt).toLocaleString()}
                            </time>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1 text-muted-foreground">No webhook deliveries recorded for this integration.</p>
                    )}
                    <p className="mt-2 text-muted-foreground">Payloads and signing secrets are not displayed here.</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-[10px] text-muted-foreground">No integrations configured for this tenant.</p>
        )}
      </div>
    </section>
  );
}

function incidentTone(severity: string): 'critical' | 'elevated' | 'observed' {
  return severity === 'CRITICAL' || severity === 'HIGH'
    ? 'critical'
    : severity === 'MEDIUM'
      ? 'elevated'
      : 'observed';
}

function incidentAge(isoDate: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

type InvariantMapping = {
  id: string;
  name: string;
  status: string;
  predicateExpression: string;
  repairRepository: string | null;
  repairFilePath: string | null;
  repairRequiredChecks: string[];
  integration?: { name: string; type: string };
  repairReadiness?: {
    state: 'MANUAL_REVIEW' | 'BLOCKED_NO_REQUIRED_CHECKS' | 'BLOCKED_MISSING_BUSINESS_OUTCOME_CHECK' | 'READY_FOR_TARGET_REVIEW';
    reason: string;
    requiredChecks: string[];
    adapterId?: string | null;
  };
};

function RepairTargetPanel() {
  const [items, setItems] = useState<InvariantMapping[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { repository: string; filePath: string; requiredChecks: string }>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetchShapi<{ data: InvariantMapping[] }>('invariants?pageSize=100');
      setItems(response.data ?? []);
      setDrafts(Object.fromEntries((response.data ?? []).map(item => [item.id, {
        repository: item.repairRepository ?? '',
        filePath: item.repairFilePath ?? '',
        requiredChecks: item.repairRequiredChecks?.join('\n') ?? '',
      }])));
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load invariants');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async (item: InvariantMapping) => {
    const draft = drafts[item.id] ?? { repository: '', filePath: '', requiredChecks: '' };
    const repository = draft.repository.trim();
    const filePath = draft.filePath.trim();
    if (Boolean(repository) !== Boolean(filePath)) {
      setMessage('Repository and file path must be set together, or both cleared.');
      return;
    }
    setSavingId(item.id);
    setMessage(null);
    try {
      const updated = await fetchShapi<InvariantMapping>(`invariants/${item.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repairRepository: repository || null,
          repairFilePath: filePath || null,
          repairRequiredChecks: draft.requiredChecks.split(/[\r\n,]+/).map(check => check.trim()).filter(Boolean),
        }),
      });
      setItems(current => current.map(row => row.id === item.id ? { ...row, ...updated } : row));
      setMessage(`${item.name} repair target saved.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save repair target');
    } finally {
      setSavingId(null);
    }
  };

  const readinessSummary = items.reduce(
    (summary, item) => {
      const state = item.repairReadiness?.state;
      if (state === 'READY_FOR_TARGET_REVIEW') summary.ready += 1;
      else if (state === 'MANUAL_REVIEW') summary.manual += 1;
      else if (state?.startsWith('BLOCKED')) summary.blocked += 1;
      return summary;
    },
    { ready: 0, manual: 0, blocked: 0 },
  );

  return (
    <section id="repair-targets" className="mt-4 rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Repair targets</h2>
          <p className="text-[11px] text-muted-foreground">
            Map an invariant to the exact GitHub file where a safe predicate repair may be proposed.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>
      {!loading && items.length > 0 && (
        <div aria-label="Repair readiness summary" className="flex flex-wrap gap-2 border-b border-border px-4 py-2 font-mono text-[10px] text-muted-foreground">
          <span className="text-success">{readinessSummary.ready} ready for target review</span>
          <span className="text-warning">{readinessSummary.manual} manual review</span>
          <span className={readinessSummary.blocked ? 'text-critical' : 'text-muted-foreground'}>
            {readinessSummary.blocked} blocked
          </span>
        </div>
      )}
      {message && <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">{message}</p>}
      {loading && <p className="px-4 py-5 text-xs text-muted-foreground">Loading invariants…</p>}
      {!loading && items.length === 0 && <p className="px-4 py-5 text-xs text-muted-foreground">No invariants configured yet.</p>}
      {!loading && items.length > 0 && (
        <div className="divide-y divide-border">
          {items.map(item => {
            const draft = drafts[item.id] ?? { repository: '', filePath: '', requiredChecks: '' };
            const readiness = item.repairReadiness;
            const readinessTone = readiness?.state === 'READY_FOR_TARGET_REVIEW'
              ? 'bg-success/15 text-success'
              : readiness?.state.startsWith('BLOCKED')
                ? 'bg-critical/15 text-critical'
                : 'bg-warning/15 text-warning';
            return (
              <div key={item.id} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium">{item.name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {item.integration?.name ?? 'integration'} · {item.status}
                  </span>
                  {readiness && (
                    <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${readinessTone}`}>
                      {readiness.state.replaceAll('_', ' ')}
                    </span>
                  )}
                </div>
                <p className="truncate font-mono text-[10px] text-muted-foreground">{item.predicateExpression}</p>
                {readiness && (
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground">{readiness.reason}</p>
                    {readiness.adapterId && (
                      <p className="font-mono text-[10px] text-muted-foreground">reviewed adapter: {readiness.adapterId}</p>
                    )}
                  </div>
                )}
                <div className="grid gap-2 md:grid-cols-[1fr_1.4fr_1.1fr_auto]">
                  <input
                    value={draft.repository}
                    onChange={event => setDrafts(current => ({ ...current, [item.id]: { ...draft, repository: event.target.value } }))}
                    placeholder="owner/repository"
                    aria-label={`${item.name} GitHub repository`}
                    className="h-9 rounded border border-border bg-background px-2 font-mono text-xs outline-none placeholder:text-muted-foreground"
                  />
                  <input
                    value={draft.requiredChecks}
                    onChange={event => setDrafts(current => ({ ...current, [item.id]: { ...draft, requiredChecks: event.target.value } }))}
                    placeholder="target-tests, lint (optional)"
                    aria-label={`${item.name} required CI checks`}
                    className="h-9 rounded border border-border bg-background px-2 text-xs outline-none placeholder:text-muted-foreground"
                  />
                  <input
                    value={draft.filePath}
                    onChange={event => setDrafts(current => ({ ...current, [item.id]: { ...draft, filePath: event.target.value } }))}
                    placeholder="src/invariants/payments.ts"
                    aria-label={`${item.name} repair file path`}
                    className="h-9 rounded border border-border bg-background px-2 font-mono text-xs outline-none placeholder:text-muted-foreground"
                  />
                  <Button size="sm" onClick={() => void save(item)} disabled={savingId === item.id}>
                    {savingId === item.id ? 'Saving…' : 'Save target'}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function HealingDashboardContent() {
  const [paused, setPaused] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [diagnosisOpen, setDiagnosisOpen] = useState(false);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosisResult, setDiagnosisResult] = useState<LiveDiagnosis | null>(null);
  const [diagnosisError, setDiagnosisError] = useState<string | null>(null);
  const [replayCandidate, setReplayCandidate] = useState('');
  const [replayBusy, setReplayBusy] = useState(false);
  const [replayMessage, setReplayMessage] = useState<string | null>(null);
  const [prBusy, setPrBusy] = useState(false);
  const [prMessage, setPrMessage] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState<string | null>(null);
  const [repairPreview, setRepairPreview] = useState<{
    candidateId: string;
    result: RepairPreview;
  } | null>(null);
  const [reviewedPreviewCandidateId, setReviewedPreviewCandidateId] = useState<string | null>(null);
  const [githubInstallations, setGithubInstallations] = useState<GitHubInstallation[]>([]);
  const [githubStatus, setGithubStatus] = useState<GitHubStatus | null>(null);
  const [githubPrs, setGithubPrs] = useState<GitHubPr[]>([]);
  const [githubPrLoading, setGithubPrLoading] = useState(false);
  const [githubPrError, setGithubPrError] = useState<string | null>(null);
  const [githubPrVerifyBusy, setGithubPrVerifyBusy] = useState<string | null>(null);
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubLoadError, setGithubLoadError] = useState<string | null>(null);
  const [liveSnapshot, setLiveSnapshot] = useState<LiveSnapshot | null>(null);
  const [alertStatus, setAlertStatus] = useState<AlertStatus | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  const signOut = async () => {
    try {
      await fetch(`${SHAPI_API}/auth/logout`, { method: 'POST', credentials: 'include' });
    } finally {
      window.location.reload();
    }
  };

  const openDiagnosis = () => {
    const selected = liveSnapshot?.incidents.find(
      item => item.status !== 'RESOLVED' && item.status !== 'DISMISSED'
    );
    const incidentId = selected?.id ?? null;
    setSelectedIncidentId(incidentId);
    setDiagnosisResult(null);
    setDiagnosisError(null);
    setReplayCandidate('');
    setReplayMessage(null);
    setPrMessage(null);
    setRepairPreview(null);
    setReviewedPreviewCandidateId(null);
    setGithubLoading(true);
    setGithubLoadError(null);
    setGithubPrLoading(Boolean(incidentId));
    setGithubPrError(null);
    if (selected && selected.status !== 'DETECTED') {
      setDiagnosing(true);
      void fetchShapi<{
        rootCause: string | null;
        suggestedFix: string | null;
        repairCandidates: LiveDiagnosis['candidates'];
      }>(`incidents/${incidentId}`)
        .then(detail =>
          setDiagnosisResult({
            rootCause: detail.rootCause ?? 'Diagnosis not recorded',
            suggestedFix: detail.suggestedFix ?? 'Review this incident manually',
            confidence: Math.max(
              0,
              ...detail.repairCandidates.map(candidate => candidate.confidence)
            ),
            evidence: [],
            candidates: detail.repairCandidates,
          })
        )
        .catch(error =>
          setDiagnosisError(
            error instanceof Error ? error.message : 'Could not load saved diagnosis'
          )
        )
        .finally(() => setDiagnosing(false));
    }
    void Promise.all([
      fetchShapi<GitHubInstallation[]>('github/installations'),
      fetchShapi<GitHubStatus>('github/status'),
      incidentId
        ? fetchShapi<GitHubPr[]>(`github/incidents/${incidentId}/prs`)
        : Promise.resolve([] as GitHubPr[]),
    ])
      .then(([installations, status, prs]) => {
        setGithubInstallations(installations);
        setGithubStatus(status);
        setGithubPrs(prs);
      })
      .catch(() => {
        setGithubInstallations([]);
        setGithubStatus(null);
        setGithubPrs([]);
        setGithubLoadError(
          'SHAPI could not read GitHub App installations. Check the API key and backend configuration.'
        );
        setGithubPrError('SHAPI could not load repair PRs for this incident.');
      })
      .finally(() => {
        setGithubLoading(false);
        setGithubPrLoading(false);
      });
    setDiagnosisOpen(true);
  };

  const runLiveDiagnosis = async () => {
    if (!selectedIncidentId) return;
    if (
      liveSnapshot?.incidents.find(item => item.id === selectedIncidentId)?.status !== 'DETECTED'
    ) {
      setDiagnosisError(
        'This incident has already been diagnosed. Open a newly detected incident to run diagnosis.'
      );
      return;
    }
    setDiagnosing(true);
    setDiagnosisError(null);
    try {
      const response = await fetchShapi<{
        diagnosis: Omit<LiveDiagnosis, 'candidates'>;
        candidates: LiveDiagnosis['candidates'];
      }>(`incidents/${selectedIncidentId}/diagnose`, { method: 'POST' });
      setDiagnosisResult({ ...response.diagnosis, candidates: response.candidates ?? [] });
    } catch (error) {
      setDiagnosisError(error instanceof Error ? error.message : 'Diagnosis failed');
    } finally {
      setDiagnosing(false);
    }
  };

  const runReplay = async (candidate: LiveDiagnosis['candidates'][number]) => {
    const incident = liveSnapshot?.incidents.find(item => item.id === selectedIncidentId);
    if (!incident) return;
    const fixCandidate = replayCandidate.trim();
    if (!fixCandidate) {
      setReplayMessage('Enter a replay fix candidate, for example add_field:status:"paid"');
      return;
    }
    setReplayBusy(true);
    setReplayMessage(null);
    try {
      const events = await fetchShapi<{ data: Array<{ id: string }> }>(
        `integrations/${incident.integrationId}/webhook-events?pageSize=1&status=COMPLETED`
      );
      const event = events.data?.[0];
      if (!event) throw new Error('No completed webhook event is available for replay');
      const job = await fetchShapi<{ status: string; result?: string | null }>(
        `incidents/${incident.id}/replay`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ webhookEventId: event.id, fixCandidate }),
        }
      );
      setReplayMessage(
        `Replay ${job.status.toLowerCase()}${job.result ? ` · ${job.result.toLowerCase()}` : ''}`
      );
    } catch (error) {
      setReplayMessage(error instanceof Error ? error.message : 'Replay request failed');
    } finally {
      setReplayBusy(false);
    }
  };

  const createRepairPr = async (candidate: LiveDiagnosis['candidates'][number]) => {
    const incident = liveSnapshot?.incidents.find(item => item.id === selectedIncidentId);
    const repository = candidate.repository;
    const installation = githubInstallations.find(
      item => repository && item.repositories.includes(repository)
    );
    if (!incident || githubLoading || !installation || !repository) {
      setPrMessage(
        githubLoadError ??
          'This candidate needs a mapped repository connected to GitHub before a PR can be created.'
      );
      return;
    }
    if (!candidate.id || !Array.isArray(candidate.changes) || candidate.changes.length === 0) {
      setPrMessage(
        'This candidate needs manual review; no applicable repository patch is available.'
      );
      return;
    }
    if (reviewedPreviewCandidateId !== candidate.id) {
      setPrMessage('Preview the exact patch and confirm your review before creating a PR.');
      return;
    }
    setPrBusy(true);
    setPrMessage(null);
    try {
      const pr = await fetchShapi<GitHubPr>(`github/incidents/${incident.id}/pr`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          installationId: installation.id,
          repository,
          candidateId: candidate.id,
          previewToken: repairPreview?.candidateId === candidate.id ? repairPreview.result.previewToken : undefined,
          title: `SHAPI repair: ${candidate.description}`,
          body: diagnosisResult?.suggestedFix ?? candidate.description,
        }),
      });
      setGithubPrs(current => [pr, ...current.filter(item => item.id !== pr.id)]);
      setPrMessage(`PR #${pr.prNumber} created · ${pr.prUrl}`);
    } catch (error) {
      setPrMessage(error instanceof Error ? error.message : 'Repair PR creation failed');
    } finally {
      setPrBusy(false);
    }
  };
  const previewRepairPr = async (candidate: LiveDiagnosis['candidates'][number]) => {
    const incident = liveSnapshot?.incidents.find(item => item.id === selectedIncidentId);
    const repository = candidate.repository;
    const installation = githubInstallations.find(
      item => repository && item.repositories.includes(repository)
    );
    if (!incident || githubLoading || !installation || !repository) {
      setPrMessage(
        githubLoadError ??
          'This candidate needs a mapped repository connected to GitHub before it can be previewed.'
      );
      return;
    }
    if (!candidate.id || !Array.isArray(candidate.changes) || candidate.changes.length === 0) {
      setPrMessage('This candidate needs manual review; no applicable repository patch is available.');
      return;
    }
    setPreviewBusy(candidate.id);
    setPrMessage(null);
    try {
      const result = await fetchShapi<RepairPreview>(`github/incidents/${incident.id}/pr/preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ installationId: installation.id, repository, candidateId: candidate.id }),
      });
      setRepairPreview({ candidateId: candidate.id, result });
      setReviewedPreviewCandidateId(null);
      setPrMessage(`Previewed ${result.changes.length} file${result.changes.length === 1 ? '' : 's'} at ${result.base}@${result.baseSha.slice(0, 8)}. Review it before creating a PR.`);
    } catch (error) {
      setRepairPreview(null);
      setPrMessage(error instanceof Error ? error.message : 'Repair preview failed');
    } finally {
      setPreviewBusy(null);
    }
  };
  const verifyRepairPr = async (pr: GitHubPr) => {
    setGithubPrVerifyBusy(pr.id);
    setGithubPrError(null);
    try {
      const result = await fetchShapi<{
        verified: boolean;
        ciPassed: boolean;
        merged: boolean;
        closed: boolean;
        pr: GitHubPr;
        proof: GitHubPr['proof'];
      }>(`github/prs/${pr.id}/verify`, { method: 'POST' });
      setGithubPrs(current =>
        current.map(item =>
          item.id === pr.id
            ? {
                ...item,
                ...result.pr,
                status: result.merged ? 'MERGED' : result.closed ? 'CLOSED' : result.pr.status,
                verified: result.verified,
                proof: result.proof,
              }
            : item
        )
      );
      setPrMessage(
        `PR #${pr.prNumber} checked · ${result.merged ? 'merged' : result.closed ? 'closed' : result.ciPassed ? 'CI passed' : 'CI pending'}`
      );
    } catch (error) {
      setGithubPrError(error instanceof Error ? error.message : 'GitHub PR verification failed');
    } finally {
      setGithubPrVerifyBusy(null);
    }
  };
  const refreshGitHubPrs = async () => {
    if (!selectedIncidentId || githubPrLoading) return;
    setGithubPrLoading(true);
    setGithubPrError(null);
    try {
      setGithubPrs(await fetchShapi<GitHubPr[]>(`github/incidents/${selectedIncidentId}/prs`));
    } catch (error) {
      setGithubPrError(error instanceof Error ? error.message : 'GitHub PR refresh failed');
    } finally {
      setGithubPrLoading(false);
    }
  };
  useEffect(() => {
    if (!diagnosisOpen || !selectedIncidentId) return;
    let active = true;
    const refresh = async () => {
      try {
        const prs = await fetchShapi<GitHubPr[]>(`github/incidents/${selectedIncidentId}/prs`);
        if (active) {
          setGithubPrs(prs);
          setGithubPrError(null);
        }
      } catch (error) {
        if (active)
          setGithubPrError(error instanceof Error ? error.message : 'GitHub PR refresh failed');
      }
    };
    const timer = window.setInterval(() => {
      void refresh();
    }, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [diagnosisOpen, selectedIncidentId]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [summary, incidentsResponse] = await Promise.all([
          fetchShapi<LiveSnapshot['summary']>('drift/summary'),
          fetchShapi<{ data: LiveSnapshot['incidents'] }>('incidents?pageSize=100'),
        ]);
        if (active) {
          setLiveSnapshot({ summary, incidents: incidentsResponse.data ?? [] });
          setApiError(null);
        }
      } catch (error) {
        if (active) setApiError(error instanceof Error ? error.message : 'SHAPI API unavailable');
      }
      try {
        const status = await fetchShapi<AlertStatus>('alerts/status');
        if (active) setAlertStatus(status);
      } catch {
        if (active) setAlertStatus(null);
      }
    };
    if (paused) {
      return () => {
        active = false;
      };
    }
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [paused]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key === 'Escape') {
        setCommandOpen(false);
        setDiagnosisOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const activeIncidents =
    liveSnapshot?.incidents.filter(
      incident => incident.status !== 'RESOLVED' && incident.status !== 'DISMISSED'
    ) ?? [];
  const activeIncidentCount = activeIncidents.length;
  const activeRepairCandidates = activeIncidents.flatMap(incident => incident.repairCandidates ?? []);
  const prReadyCandidateCount = activeRepairCandidates.filter(
    candidate =>
      candidate.reviewStatus === 'PR_READY_AFTER_REVIEW' && candidate.automationEligible === true
  ).length;
  // Missing readiness metadata must remain visible as review work. This keeps
  // stale/partial API payloads fail-closed instead of presenting a false zero.
  const manualReviewCount = activeRepairCandidates.filter(
    candidate => !(candidate.reviewStatus === 'PR_READY_AFTER_REVIEW' && candidate.automationEligible === true)
  ).length;
  const visibleReports = activeIncidents.length
    ? activeIncidents.map(incident => ({
        service: incident.integrationId,
        issue: incident.title,
        source: incident.integrationId,
        time: incidentAge(incident.detectedAt),
        tone: incidentTone(incident.severity),
      }))
    : [];
  const severityCounts = activeIncidents.reduce(
    (counts, incident) => {
      const severity = incident.severity.toUpperCase();
      if (severity === 'CRITICAL' || severity === 'HIGH') counts.critical += 1;
      else if (severity === 'MEDIUM') counts.elevated += 1;
      else counts.observed += 1;
      return counts;
    },
    { critical: 0, elevated: 0, observed: 0 }
  );
  const affectedIntegrations = new Set(activeIncidents.map(incident => incident.integrationId)).size;
  const metrics = [
    {
      label: 'SHAPI connection',
      value: liveSnapshot ? 'LIVE' : '—',
      suffix: '',
      badge: liveSnapshot ? '10s refresh' : apiError ? 'unavailable' : 'connecting',
      icon: HeartPulse,
      tone: 'success',
    },
    {
      label: 'Active incidents',
      value: String(activeIncidentCount).padStart(2, '0'),
      suffix: '',
      badge: liveSnapshot ? `${activeIncidentCount} live` : 'connecting',
      icon: CircleAlert,
      tone: 'critical',
    },
    {
      label: 'Monitored integrations',
      value: String(liveSnapshot?.summary.monitoredIntegrations ?? '—'),
      suffix: '',
      badge: liveSnapshot ? 'live SHAPI' : 'connecting',
      icon: Network,
      tone: 'observed',
    },
    {
      label: 'Invariants monitored',
      value: String(liveSnapshot?.summary.totalInvariants ?? '—'),
      suffix: '',
      badge: liveSnapshot ? 'behavioral checks' : 'connecting',
      icon: ShieldCheck,
      tone: 'success',
    },
  ];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[212px] flex-col border-r border-border bg-sidebar lg:flex">
        <div className="flex h-16 items-center gap-2.5 border-b border-border px-4">
          <span className="grid size-8 place-items-center rounded bg-primary/10 text-primary">
            <HeartPulse className="size-[18px]" />
          </span>
          <div className="leading-tight">
            <div className="text-[13px] font-bold uppercase">Pulseguard</div>
            <div className="font-mono text-[9px] uppercase text-muted-foreground">
              API assurance platform
            </div>
          </div>
        </div>
        <div className="px-3 pt-4">
          <div className="flex h-9 items-center justify-between rounded border border-border bg-secondary/55 px-3 text-xs">
            <span className="flex items-center gap-2">
              <i
                className={`size-1.5 rounded-full ${liveSnapshot ? 'bg-success' : 'bg-warning'}`}
              />
              {liveSnapshot ? 'Live SHAPI API' : 'Connecting'}
            </span>
            <ChevronDown className="size-3 text-muted-foreground" />
          </div>
        </div>
        <nav aria-label="Main navigation" className="mt-4 space-y-1 px-3">
          <a className="nav-item nav-item-active" href="#overview">
            <CircleGauge />
            Command center
          </a>
          <a className="nav-item" href="#incidents">
            <CircleAlert />
            Incidents & triage
            <span className="ml-auto rounded bg-critical/15 px-1.5 text-[10px] text-critical">
              {activeIncidentCount}
            </span>
          </a>
          <a className="nav-item" href="#traffic">
            <Globe2 />
            Incident signals
          </a>
          <a className="nav-item" href="#healing">
            <GitBranch />
            Incident activity
            <span className="ml-auto rounded bg-warning/15 px-1.5 text-[10px] text-warning">
              {activeIncidentCount}
            </span>
          </a>
          <a className="nav-item" href="#repair-targets">
            <Settings2 />
            Repair targets
            <span className="ml-auto rounded bg-critical/15 px-1.5 text-[10px] text-critical">
              {manualReviewCount}
            </span>
          </a>
          <a className="nav-item" href="#connections">
            <GitBranch />
            Connections
          </a>
          <a className="nav-item" href="#incidents">
            <Network />
            Service events
          </a>
        </nav>
        <div className="mt-auto px-3 pb-3">
          <div className="rounded border border-border bg-secondary/50 p-3">
            <div className="flex items-center gap-2 text-xs font-medium">
              <span
                className={`size-2 rounded-full ${liveSnapshot ? 'bg-success' : 'bg-warning'}`}
              />
              {liveSnapshot ? 'SHAPI systems online' : 'Waiting for SHAPI'}
            </div>
            <div className="mt-2 font-mono text-[10px] text-muted-foreground">
              {liveSnapshot?.summary.monitoredIntegrations ?? 0} INTEGRATIONS{' '}
              <span className="float-right">{liveSnapshot ? 'LIVE' : 'CONNECTING'}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          <div className="grid size-7 place-items-center rounded bg-secondary text-[10px] font-semibold">
            PG
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium">Pulseguard</p>
            <p className="text-[10px] text-muted-foreground">Dashboard preview</p>
          </div>
          <Settings2 className="ml-auto size-4 text-muted-foreground" />
        </div>
      </aside>

      <div className="min-w-0 lg:ml-[212px]">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur md:px-5">
          <div className="flex min-w-0 items-center gap-2 text-xs">
            <span className="font-semibold lg:hidden">Pulseguard</span>
            <span className="hidden text-muted-foreground lg:inline">PULSEGUARD</span>
            <span className="hidden text-muted-foreground lg:inline">›</span>
            <span className="truncate">Command center</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCommandOpen(true)}
              className="hidden w-56 justify-start text-muted-foreground sm:inline-flex"
            >
              <Search className="size-3.5" />
              <span className="truncate">Search signals, events...</span>
              <kbd className="ml-auto font-mono text-[10px]">⌘K</kbd>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCommandOpen(true)}
              aria-label="Search"
              className="sm:hidden"
            >
              <Search />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={openDiagnosis}
              aria-label="View alerts"
              title="View alerts"
            >
              <Bell className="size-4" />
            </Button>
            {!SHAPI_KEY && (
              <Button variant="outline" size="sm" onClick={() => void signOut()}>
                Sign out
              </Button>
            )}
          </div>
        </header>
        <section id="overview" className="mx-auto max-w-[1600px] px-4 pb-12 pt-5 md:px-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-lg font-semibold">Command center</h1>
              <p className="text-xs text-muted-foreground">
                {liveSnapshot
                  ? `Live SHAPI telemetry · ${liveSnapshot.summary.monitoredIntegrations} integrations · refreshes every 10s`
                  : apiError
                    ? `SHAPI API connection failed · ${apiError}`
                    : 'Connecting to live SHAPI telemetry…'}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={openDiagnosis}>
              <Sparkles className="size-3.5" />
              Run diagnosis
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
            {metrics.map(metric => (
              <article
                key={metric.label}
                className="min-w-0 rounded-md border border-border bg-card p-3.5 md:p-4"
              >
                <div className="flex items-start justify-between gap-1">
                  <span className="grid size-7 place-items-center rounded border border-border bg-secondary/50 text-muted-foreground">
                    <metric.icon className="size-3.5" />
                  </span>
                  <span className={`metric-badge metric-${metric.tone}`}>● {metric.badge}</span>
                </div>
                <p className="mt-4 text-[10px] font-semibold uppercase text-muted-foreground">
                  {metric.label}
                </p>
                <div className="mt-1 flex items-end justify-between gap-1">
                  <p className="min-w-0 text-xl font-bold tabular-nums md:text-2xl">
                    {metric.value}
                    <span className="ml-0.5 text-sm">{metric.suffix}</span>
                  </p>
                </div>
              </article>
            ))}
          </div>

          <ConnectionsPanel />

          <section
            id="traffic"
            className="mt-3.5 overflow-hidden rounded-md border border-border bg-card"
          >
            <div className="flex min-h-[58px] flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Globe2 className="size-4 text-observed" />
                  Live incident signal field
                </h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {liveSnapshot
                    ? 'Current incident state from SHAPI · location telemetry is not collected'
                    : apiError
                      ? 'SHAPI is unavailable; live signals are hidden'
                      : 'Connecting to live SHAPI incident data…'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded bg-critical/15 px-2 py-1 text-[10px] text-critical">
                  ●{' '}
                  {liveSnapshot
                    ? `${activeIncidentCount} active incident${activeIncidentCount === 1 ? '' : 's'}`
                    : 'Waiting for live data'}
                </span>
                <Button variant="outline" size="sm" onClick={() => setPaused(!paused)}>
                  {paused ? <Play /> : <Pause />}
                  {paused ? 'Resume' : 'Pause'}
                </Button>
              </div>
            </div>
            <div className="grid lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,1fr)]">
              <div className="relative min-h-[390px] overflow-hidden bg-secondary/20 sm:min-h-[480px] lg:min-h-[520px]">
                {liveSnapshot ? (
                  <div className="grid h-full place-items-center p-6 sm:p-10">
                    <div className="w-full max-w-xl rounded-lg border border-border bg-background/80 p-6 shadow-xl">
                      <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase text-muted-foreground">
                        <span className="text-success">● Live SHAPI telemetry</span>
                        <span>refreshed every 10s</span>
                      </div>
                      <div className="mt-8 flex items-end gap-3">
                        <span className="text-7xl font-bold tabular-nums text-foreground">
                          {activeIncidentCount}
                        </span>
                        <span className="pb-2 text-sm text-muted-foreground">
                          active incident{activeIncidentCount === 1 ? '' : 's'}
                        </span>
                      </div>
                      <p className="mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
                        This view reports only incidents returned by SHAPI. Geographic coordinates
                        are intentionally omitted because the platform does not collect them.
                      </p>
                      <div className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="rounded border border-critical/30 bg-critical/5 p-3">
                          <p className="font-mono text-lg font-semibold text-critical">{severityCounts.critical}</p>
                          <p className="mt-1 text-[10px] text-muted-foreground">Critical / high</p>
                        </div>
                        <div className="rounded border border-warning/30 bg-warning/5 p-3">
                          <p className="font-mono text-lg font-semibold text-warning">{severityCounts.elevated}</p>
                          <p className="mt-1 text-[10px] text-muted-foreground">Medium</p>
                        </div>
                        <div className="rounded border border-observed/30 bg-observed/5 p-3">
                          <p className="font-mono text-lg font-semibold text-observed">{severityCounts.observed}</p>
                          <p className="mt-1 text-[10px] text-muted-foreground">Low / observed</p>
                        </div>
                        <div className="rounded border border-border bg-secondary/40 p-3">
                          <p className="font-mono text-lg font-semibold">{affectedIntegrations}</p>
                          <p className="mt-1 text-[10px] text-muted-foreground">Affected integrations</p>
                        </div>
                      </div>
                      {!activeIncidentCount && (
                        <div className="mt-5 flex items-center gap-2 rounded border border-success/30 bg-success/5 px-3 py-2 text-xs text-success">
                          <Check className="size-4" /> No active incidents. SHAPI is monitoring normally.
                        </div>
                      )}
                    </div>
                  </div>
                ) : apiError ? (
                  <div className="grid h-full place-items-center p-8 text-center">
                    <div className="max-w-sm">
                      <CircleAlert className="mx-auto size-8 text-critical" />
                      <p className="mt-3 text-sm font-semibold">Live incident data unavailable</p>
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{apiError}</p>
                    </div>
                  </div>
                ) : (
                  <div className="grid h-full place-items-center text-sm text-muted-foreground">
                    Connecting to SHAPI…
                  </div>
                )}
              </div>
              <div className="border-t border-border lg:border-l lg:border-t-0">
                <div className="flex h-10 items-center justify-between border-b border-border px-3.5 font-mono text-[10px] uppercase text-muted-foreground">
                  <span>Incident context</span>
                  <span>{paused ? 'Paused' : liveSnapshot ? 'SHAPI · 10s' : 'Waiting'}</span>
                </div>
                <div className="divide-y divide-border">
                  {visibleReports.map(report => (
                    <div
                      key={`${report.service}-${report.issue}`}
                      className="flex min-h-[77px] gap-2.5 px-3.5 py-3 transition-colors hover:bg-secondary/40"
                    >
                      <span
                        className={`mt-1.5 size-1.5 shrink-0 rounded-full ${report.tone === 'critical' ? 'bg-critical' : report.tone === 'elevated' ? 'bg-warning' : 'bg-observed'}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">
                          {report.service}
                          <span className="font-normal text-muted-foreground">
                            {' · SHAPI'}
                          </span>
                        </p>
                        <p className="mt-1 truncate text-[11px]">{report.issue}</p>
                        <p className="mt-1 font-mono text-[9px] uppercase text-muted-foreground">
                          {report.source} · live SHAPI incident
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <time className="font-mono text-[9px] text-muted-foreground">
                          {report.time}
                        </time>
                      </div>
                    </div>
                  ))}
                </div>
                {!visibleReports.length && liveSnapshot && (
                  <div className="m-3 rounded border border-success/30 bg-success/5 p-3 text-[11px] leading-relaxed text-success">
                    <Check className="mr-1.5 inline-block size-3" />
                    No live incident signals are currently reported.
                  </div>
                )}
                {!liveSnapshot && !apiError && (
                  <div className="m-3 rounded border border-border bg-secondary/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
                    Waiting for the first live SHAPI response.
                  </div>
                )}
                {apiError && (
                  <div className="m-3 rounded border border-critical/30 bg-critical/5 p-3 text-[11px] leading-relaxed text-critical">
                    Live signals are hidden until the SHAPI connection recovers.
                  </div>
                )}
              </div>
            </div>
          </section>

          <section id="healing" className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
            <div className="rounded-md border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold">Incident activity</h2>
                <p className="text-[11px] text-muted-foreground">
                  {liveSnapshot
                    ? 'Live incident states from SHAPI'
                    : 'Waiting for SHAPI telemetry'}
                </p>
              </div>
              <div className="divide-y divide-border text-xs">
                {activeIncidents.length ? (
                  activeIncidents.map(incident => (
                    <div key={incident.id} className="flex items-center gap-3 px-4 py-3">
                      <TriangleAlert className="size-4 text-warning" />
                      <div>
                        <p>{incident.title}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">
                          {incident.integrationId} · {incident.severity}
                        </p>
                      </div>
                      <span className="ml-auto status-healing">{incident.status}</span>
                    </div>
                  ))
                ) : (
                  <div className="flex items-center gap-3 px-4 py-6 text-muted-foreground">
                    <Check className="size-4 text-success" />
                    <p>
                      {liveSnapshot
                        ? 'No active incidents'
                        : 'Connecting to live incident activity…'}
                    </p>
                  </div>
                )}
              </div>
            </div>
            <div className="rounded-md border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold">System posture</h2>
                <p className="text-[11px] text-muted-foreground">
                  {liveSnapshot
                    ? `${liveSnapshot.summary.monitoredIntegrations} monitored integrations`
                    : 'Waiting for SHAPI telemetry'}
                </p>
              </div>
              <div className="grid grid-cols-4 divide-x divide-border py-5 text-center">
                <div>
                  <p className="text-xl font-semibold text-success">
                    {liveSnapshot ? liveSnapshot.summary.monitoredIntegrations : '—'}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Integrations</p>
                </div>
                <div>
                  <p className="text-xl font-semibold text-warning">
                    {liveSnapshot ? activeIncidentCount : '—'}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Active</p>
                </div>
                <div>
                  <p className="text-xl font-semibold text-observed">
                    {liveSnapshot ? liveSnapshot.summary.totalInvariants : '—'}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Invariants</p>
                </div>
                <div>
                  <p className="text-xl font-semibold text-critical">
                    {liveSnapshot ? manualReviewCount : '—'}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Repair review</p>
                  {liveSnapshot && (
                    <p className="mt-1 text-[9px] text-success">
                      {prReadyCandidateCount} PR-ready
                    </p>
                  )}
                </div>
              </div>
              <div className="border-t border-border px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-semibold">Alert delivery</h3>
                    <p className="text-[10px] text-muted-foreground">
                      {alertStatus
                        ? alertStatus.webhookConfigured
                          ? 'Durable webhook outbox · live'
                          : 'Webhook delivery disabled'
                        : 'Alert status unavailable'}
                    </p>
                  </div>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                      alertStatus?.failed
                        ? 'bg-critical/15 text-critical'
                        : alertStatus?.processing || alertStatus?.retrying
                          ? 'bg-warning/15 text-warning'
                          : 'bg-success/15 text-success'
                    }`}
                  >
                    {alertStatus ? `${alertStatus.failed} failed` : '—'}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-5 divide-x divide-border text-center">
                  {[
                    ['Pending', alertStatus?.pending],
                    ['Processing', alertStatus?.processing],
                    ['Retrying', alertStatus?.retrying],
                    ['Failed', alertStatus?.failed],
                    ['Delivered', alertStatus?.delivered],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <p className="font-mono text-sm font-semibold">{value ?? '—'}</p>
                      <p className="text-[9px] text-muted-foreground">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
          <section
            id="incidents"
            className="mt-4 overflow-hidden rounded-md border border-border bg-card"
          >
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">Recent incidents</h2>
              <p className="text-[11px] text-muted-foreground">
                {liveSnapshot ? 'Live incidents from SHAPI' : 'Waiting for live SHAPI data'}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-xs">
                <thead className="bg-secondary/40 font-mono text-[10px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Integration</th>
                    <th className="px-4 py-3 font-medium">Detection</th>
                    <th className="px-4 py-3 font-medium">Severity</th>
                    <th className="px-4 py-3 font-medium">State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(activeIncidents.length
                    ? activeIncidents.map(item => ({
                        integration: item.integrationId,
                        issue: item.title,
                        severity: item.severity,
                        state: item.status,
                      }))
                    : [
                        {
                          integration: liveSnapshot ? 'SHAPI' : '—',
                          issue: liveSnapshot
                            ? 'No active incidents'
                            : apiError
                              ? 'Live incident data unavailable'
                              : 'Waiting for live SHAPI data',
                          severity: liveSnapshot ? '—' : '—',
                          state: liveSnapshot ? 'HEALTHY' : 'WAITING',
                        },
                      ]
                  ).map(item => (
                    <tr key={`${item.integration}-${item.issue}`}>
                      <td className="px-4 py-3 font-mono">{item.integration}</td>
                      <td className="px-4 py-3 text-muted-foreground">{item.issue}</td>
                      <td className="px-4 py-3">{item.severity}</td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            item.state === 'HEALTHY' || item.state === 'RESOLVED' || item.state === 'DISMISSED'
                              ? 'status-resolved'
                              : 'status-healing'
                          }
                        >
                          {item.state}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
        <div className="mx-auto max-w-[1600px] px-4 pb-12 md:px-5">
          <RepairTargetPanel />
        </div>
      </div>
      {commandOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-center bg-overlay px-4 pt-[16vh]"
          onClick={() => setCommandOpen(false)}
        >
          <div
            className="h-fit w-full max-w-lg rounded-md border border-border bg-popover shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Command className="size-4 text-primary" />
              <input
                autoFocus
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search services and signals..."
                className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close search"
                onClick={() => setCommandOpen(false)}
              >
                <X />
              </Button>
            </div>
            <div className="p-3">
              {[
                ...activeIncidents.map(
                  item => `${item.integrationId} · ${item.title}`
                ),
              ]
                .filter(item => item.toLowerCase().includes(query.toLowerCase()))
                .map(item => (
                  <div
                    key={item}
                    className="border-b border-border px-2 py-2.5 text-xs last:border-0"
                  >
                    {item}
                  </div>
                ))}
              {!activeIncidents.length && (
                <p className="px-2 py-2.5 text-xs text-muted-foreground">
                  {liveSnapshot ? 'No live signals match the current data.' : 'Waiting for live SHAPI data.'}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
      {diagnosisOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-overlay p-4"
          onClick={() => setDiagnosisOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Fleet diagnosis"
            className="w-full max-w-md rounded-md border border-border bg-popover p-5"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <ShieldCheck className="size-5 text-success" />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close diagnosis"
                onClick={() => setDiagnosisOpen(false)}
              >
                <X />
              </Button>
            </div>
            {diagnosisResult ? (
              <>
                <h2 className="mt-3 text-lg font-semibold">Live diagnosis complete</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Confidence:{' '}
                  <span className="font-mono text-foreground">
                    {Math.round(diagnosisResult.confidence * 100)}%
                  </span>
                </p>
                <p className="mt-4 border-l-2 border-warning pl-3 text-sm text-warning">
                  {diagnosisResult.rootCause}
                </p>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  {diagnosisResult.suggestedFix}
                </p>
                <div className="mt-4 space-y-1 text-xs text-muted-foreground">
                  {diagnosisResult.evidence.map(item => (
                    <p key={item}>• {item}</p>
                  ))}
                </div>
                <div className="mt-4 rounded border border-border bg-secondary/30 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">GitHub repair connection</span>
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${githubStatus?.mode === 'unconfigured' ? 'bg-critical/15 text-critical' : githubStatus?.mode === 'app' ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'}`}
                    >
                      {githubStatus?.mode ?? 'checking'}
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {githubStatus?.message ?? 'Checking GitHub configuration…'}
                  </p>
                  {githubStatus && (
                    <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                      {githubStatus.repositoryCount} repo
                      {githubStatus.repositoryCount === 1 ? '' : 's'} ·{' '}
                      {githubStatus.realInstallations} App installation
                      {githubStatus.realInstallations === 1 ? '' : 's'} · webhook{' '}
                      {githubStatus.webhookConfigured ? 'ready' : 'not configured'}
                    </p>
                  )}
                </div>
                <GitHubSetupGuide status={githubStatus} />
                <div className="mt-4 rounded border border-border bg-secondary/30 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold">Recent repair PRs</p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void refreshGitHubPrs()}
                        disabled={githubPrLoading || !selectedIncidentId}
                      >
                        {githubPrLoading ? 'Refreshing…' : 'Refresh'}
                      </Button>
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {githubPrLoading ? 'loading…' : `${githubPrs.length} total`}
                    </span>
                  </div>
                  {githubPrError ? (
                    <p className="mt-2 text-[10px] text-critical">{githubPrError}</p>
                  ) : githubPrs.length ? (
                    <div className="mt-2 space-y-2">
                      {githubPrs.map(pr => (
                        <div
                          key={pr.id}
                          className="rounded border border-border bg-background/50 p-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <a
                                href={pr.prUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="truncate font-medium text-primary hover:underline"
                              >
                                PR #{pr.prNumber} · {pr.title}
                              </a>
                              <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                                {pr.repository}
                              </p>
                            </div>
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${pr.status === 'MERGED' ? 'bg-success/15 text-success' : pr.status === 'CLOSED' ? 'bg-critical/15 text-critical' : 'bg-warning/15 text-warning'}`}
                            >
                              {pr.status}
                            </span>
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <span
                              className={`font-mono text-[10px] ${pr.verified ? 'text-success' : 'text-muted-foreground'}`}
                            >
                              {pr.verified ? 'CI VERIFIED' : 'CI PENDING'}
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void verifyRepairPr(pr)}
                              disabled={githubPrVerifyBusy === pr.id}
                            >
                              {githubPrVerifyBusy === pr.id ? 'Checking…' : 'Verify'}
                            </Button>
                          </div>
                          {pr.proof && (
                            <details className="mt-2 rounded border border-border bg-secondary/20 p-2 text-[10px]">
                              <summary className="cursor-pointer font-mono text-muted-foreground">
                                Proof evidence · {pr.proof.checksTotal} check{pr.proof.checksTotal === 1 ? '' : 's'} · {pr.proof.headSha.slice(0, 8)}
                              </summary>
                              <div className="mt-2 space-y-1">
                                {pr.proof.requiredChecks?.length ? (
                                  <p className={pr.proof.missingChecks?.length ? 'text-critical' : 'text-success'}>
                                    Required target checks: {pr.proof.missingChecks?.length ? `missing ${pr.proof.missingChecks.join(', ')}` : 'all passed'}
                                  </p>
                                ) : null}
                                {pr.proof.checkRuns.map((check, index) => (
                                  <div key={`${check.name}-${index}`} className="flex items-center justify-between gap-2">
                                    {check.detailsUrl ? (
                                      <a href={check.detailsUrl} target="_blank" rel="noreferrer" className="truncate text-primary hover:underline">
                                        {check.name}
                                      </a>
                                    ) : <span className="truncate">{check.name}</span>}
                                    <span className={check.conclusion === 'success' ? 'text-success' : 'text-critical'}>
                                      {check.status}/{check.conclusion ?? 'pending'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      No repair PRs created for this incident.
                    </p>
                  )}
                </div>
                <div className="mt-4 border-t border-border pt-3">
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                    Repair candidates
                  </p>
                  <label className="mt-2 block text-[10px] uppercase text-muted-foreground">
                    Replay fix candidate
                    <input
                      value={replayCandidate}
                      onChange={event => setReplayCandidate(event.target.value)}
                      placeholder='add_field:status:"paid"'
                      className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-xs normal-case text-foreground outline-none placeholder:text-muted-foreground"
                    />
                  </label>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Supported replay operations: add_field, modify_field, remove_field.
                  </p>
                  <div className="mt-2 space-y-2">
                    {diagnosisResult.candidates.map(candidate => {
                      const isActionableRepair = candidate.automationEligible && candidate.reviewStatus === 'PR_READY_AFTER_REVIEW';
                      return (
                        <div
                          key={`${candidate.type}-${candidate.description}`}
                          className="rounded border border-border bg-secondary/30 p-2 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span>{candidate.description}</span>
                            <span className="font-mono text-success">
                              {Math.round(candidate.confidence * 100)}%
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px]">
                            <span className="text-muted-foreground">
                              {candidate.type} · {candidate.files.join(', ') || 'no mapped files'}
                            </span>
                            <span
                              className={
                                isActionableRepair
                                  ? 'rounded border border-success/40 px-1.5 py-0.5 text-success'
                                  : 'rounded border border-critical/40 px-1.5 py-0.5 text-critical'
                              }
                            >
                              {isActionableRepair ? 'PR-READY AFTER REVIEW' : 'MANUAL REVIEW'}
                            </span>
                          </div>
                          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                            Required checks:{' '}
                            {candidate.requiredChecks.length
                              ? candidate.requiredChecks.join(', ')
                              : 'none configured'}
                          </p>
                          {!isActionableRepair && (
                            <p className="mt-2 rounded border border-critical/20 bg-critical/5 p-2 text-[10px] leading-relaxed text-critical">
                              {candidate.reviewReason}. SHAPI will not preview or create a GitHub PR
                              for this candidate automatically.
                            </p>
                          )}
                        {repairPreview?.candidateId === candidate.id && (
                          <div className="mt-2 space-y-2 rounded border border-success/30 bg-success/5 p-2">
                            <p className="font-mono text-[10px] text-success">
                              Read-only preview · {repairPreview.result.repository} ·{' '}
                              {repairPreview.result.base}@{repairPreview.result.baseSha.slice(0, 8)}
                            </p>
                            {repairPreview.result.changes.map(change => (
                              <div key={change.path} className="space-y-1">
                                <p className="font-mono text-[10px] text-foreground">
                                  {change.kind} · {change.path}
                                </p>
                                {change.before && (
                                  <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded bg-background/70 p-2 font-mono text-[10px] text-muted-foreground">
                                    {change.before.truncated ? '…\n' : ''}
                                    {change.before.text}
                                    {change.before.truncated ? '\n…' : ''}
                                  </pre>
                                )}
                                <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded bg-background/70 p-2 font-mono text-[10px] text-success">
                                  {change.after.truncated ? '…\n' : ''}
                                  {change.after.text}
                                  {change.after.truncated ? '\n…' : ''}
                                </pre>
                              </div>
                            ))}
                            <label className="flex cursor-pointer items-center gap-2 text-[10px] text-foreground">
                              <input
                                type="checkbox"
                                checked={reviewedPreviewCandidateId === candidate.id}
                                onChange={event =>
                                  setReviewedPreviewCandidateId(event.target.checked ? candidate.id : null)
                                }
                              />
                              I reviewed this exact patch and want to create its PR.
                            </label>
                          </div>
                        )}
                        <div className="mt-2 flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void runReplay(candidate)}
                            disabled={replayBusy}
                          >
                            {replayBusy ? 'Replaying…' : 'Replay'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void previewRepairPr(candidate)}
                            disabled={
                              Boolean(previewBusy) ||
                              githubLoading ||
                              githubInstallations.length === 0 ||
                              !isActionableRepair
                            }
                            title={isActionableRepair ? 'Preview the exact repository patch' : 'Manual review required: no mapped repository patch'}
                          >
                            {previewBusy === candidate.id ? 'Previewing…' : 'Preview patch'}
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => void createRepairPr(candidate)}
                            disabled={
                              prBusy ||
                              githubLoading ||
                              githubInstallations.length === 0 ||
                              !isActionableRepair ||
                              reviewedPreviewCandidateId !== candidate.id
                            }
                            title={isActionableRepair ? 'Create a PR after reviewing the exact patch' : 'Manual review required: no mapped repository patch'}
                          >
                            {prBusy
                              ? 'Creating…'
                              : reviewedPreviewCandidateId === candidate.id
                                ? 'Create PR'
                                : isActionableRepair
                                  ? 'Review preview first'
                                  : 'Manual review'}
                          </Button>
                        </div>
                        </div>
                      );
                    })}
                  </div>
                  {replayMessage && (
                    <p className="mt-2 text-xs text-muted-foreground">{replayMessage}</p>
                  )}
                  {prMessage && (
                    <p className="mt-2 break-all text-xs text-muted-foreground">{prMessage}</p>
                  )}
                  {!githubInstallations.length && (
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      GitHub preview and PR actions require a configured GitHub connection.
                    </p>
                  )}
                </div>
              </>
            ) : selectedIncidentId ? (
              <>
                <h2 className="mt-3 text-lg font-semibold">Live incident diagnosis</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  SHAPI has an active incident ready for automated root-cause analysis and repair
                  suggestions.
                </p>
                {diagnosisError && <p className="mt-3 text-xs text-critical">{diagnosisError}</p>}
                <Button
                  className="mt-5 w-full"
                  onClick={() => void runLiveDiagnosis()}
                  disabled={diagnosing}
                >
                  {diagnosing ? 'Diagnosing…' : 'Diagnose live incident'}
                </Button>
              </>
            ) : (
              <>
                <h2 className="mt-3 text-lg font-semibold">No live incident selected</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  No live incident is currently active. Diagnosis and repair actions become
                  available when SHAPI reports a real incident.
                </p>
              </>
            )}
            <Button
              variant={diagnosisResult || !selectedIncidentId ? 'default' : 'outline'}
              className="mt-5 w-full"
              onClick={() => setDiagnosisOpen(false)}
            >
              Done
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}

type DashboardAuthState = 'checking' | 'ready' | 'login' | 'unconfigured';

function DashboardAccessScreen({
  state,
  message,
}: {
  state: Exclude<DashboardAuthState, 'ready'>;
  message: string | null;
}) {
  const loginUrl = `${SHAPI_API}/auth/login`;
  const isLogin = state === 'login';
  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 text-foreground">
      <section className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded bg-primary/10 text-primary">
            <HeartPulse className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold">Pulseguard</h1>
            <p className="text-xs text-muted-foreground">SHAPI command center</p>
          </div>
        </div>
        {state === 'checking' ? (
          <p className="mt-6 text-sm text-muted-foreground">Checking dashboard access…</p>
        ) : isLogin ? (
          <>
            <h2 className="mt-6 text-base font-semibold">Sign in to continue</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              This dashboard uses your organization&apos;s single sign-on session. No API key is
              embedded in the browser.
            </p>
            <a
              className="mt-5 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              href={loginUrl}
            >
              Sign in with SSO
            </a>
          </>
        ) : (
          <>
            <h2 className="mt-6 text-base font-semibold">Dashboard authentication is not configured</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Configure OIDC for browser sign-in or provide a tenant API key through the
              dashboard runtime configuration before exposing this dashboard.
            </p>
            {message && <p className="mt-3 text-xs text-critical">{message}</p>}
          </>
        )}
      </section>
    </main>
  );
}

export function HealingDashboard() {
  const [authState, setAuthState] = useState<DashboardAuthState>(SHAPI_KEY ? 'ready' : 'checking');
  const [authMessage, setAuthMessage] = useState<string | null>(null);

  useEffect(() => {
    if (SHAPI_KEY) return;
    let active = true;
    const checkAccess = async () => {
      try {
        const sessionResponse = await fetch(`${SHAPI_API}/auth/me`, { credentials: 'include' });
        if (sessionResponse.ok) {
          if (active) setAuthState('ready');
          return;
        }
        const configResponse = await fetch(`${SHAPI_API}/auth/config`, { credentials: 'include' });
        if (!configResponse.ok) throw new Error(`Authentication configuration unavailable (${configResponse.status})`);
        const authConfig = await configResponse.json() as { oidcEnabled?: boolean };
        if (active) setAuthState(authConfig.oidcEnabled ? 'login' : 'unconfigured');
      } catch (error) {
        if (active) {
          setAuthState('unconfigured');
          setAuthMessage(error instanceof Error ? error.message : 'Could not check dashboard access');
        }
      }
    };
    void checkAccess();
    return () => {
      active = false;
    };
  }, []);

  if (authState !== 'ready') {
    return <DashboardAccessScreen state={authState} message={authMessage} />;
  }
  return <HealingDashboardContent />;
}
