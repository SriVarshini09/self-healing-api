import { useCallback, useEffect, useState } from 'react';
import './App.css';

const viteEnv = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
const runtimeEnv = (globalThis as {
  __SHAPI_CONFIG__?: { apiUrl?: string; apiKey?: string };
}).__SHAPI_CONFIG__ ?? {};
const API = runtimeEnv.apiUrl || viteEnv.VITE_API_URL || 'http://localhost:3001/api/v1';
// Keep the seeded key convenient for localhost demos, but never ship it as the
// fallback credential for a deployed dashboard.
const isLocalhost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_KEY = runtimeEnv.apiKey || viteEnv.VITE_SHAPI_API_KEY || (isLocalhost ? 'shapi_demo_local_d3v_k3y_9f2c' : '');

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined && init?.body !== null;
  const res = await fetch(`${API}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${path}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

type AuthUser = { id: string; name: string; tenantId: string; role: string };

function LoginScreen({ oidcEnabled }: { oidcEnabled: boolean }) {
  return (
    <div className="auth-shell">
      <div className="card auth-card">
        <div className="brand auth-brand"><span className="brand-mark">S</span><span>SHAPI</span></div>
        <div className="eyebrow">SECURE WORKSPACE</div>
        <h1>Sign in to SHAPI</h1>
        <p className="subtitle">Use your organization identity to inspect integration health and incidents.</p>
        {oidcEnabled ? (
          <button onClick={() => { window.location.href = `${API}/auth/login`; }}>Continue with organization login</button>
        ) : (
          <div className="card error">OIDC is not configured. Set the OIDC_* variables in the backend environment.</div>
        )}
      </div>
    </div>
  );
}

type Tab = 'overview' | 'integrations' | 'invariants' | 'incidents' | 'drift' | 'events' | 'github' | 'keys';

function Badge({ text, tone }: { text: string; tone: string }) {
  return <span className={`badge ${tone}`}>{text}</span>;
}

export function toneFor(status: string): string {
  const s = status.toUpperCase();
  if (['HEALTHY', 'RESOLVED', 'MERGED', 'COMPLETED', 'REPAIRED', 'VERIFIED'].includes(s)) return 'green';
  if (['DEGRADED', 'TRIAGED', 'REPLAYING', 'OPEN', 'RECEIVED'].includes(s)) return 'amber';
  if (['VIOLATED', 'DETECTED', 'FAILED', 'CRITICAL', 'HIGH'].includes(s)) return 'red';
  return 'gray';
}

function Overview({ refreshKey, command }: { refreshKey: number; command: boolean }) {
  const [summary, setSummary] = useState<any>(null);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [drift, setDrift] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, inc, dr] = await Promise.all([
          api<any>('/drift/summary'),
          api<any>('/incidents?pageSize=5'),
          api<any>('/drift/results?pageSize=12'),
        ]);
        if (!cancelled) {
          setSummary(s);
          setIncidents(inc.data ?? []);
          setDrift(dr.data ?? []);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (error) return <div className="card error">Backend unreachable: {error} — run backend on :3001</div>;

  const openCount = incidents.filter(i => !['RESOLVED', 'DISMISSED'].includes(String(i.status))).length;
  const tiles = [
    { label: 'Invariants', value: summary?.totalInvariants ?? '—', delta: 'asserting outcomes' },
    { label: 'Monitored integrations', value: summary?.monitoredIntegrations ?? '—', delta: 'event streams live' },
    { label: 'Active drift alerts', value: summary?.activeAlerts ?? '—', delta: 'last 24h' },
    { label: 'Open incidents', value: openCount, delta: 'needs triage' },
  ];

  return (
    <>
      {command && (
        <div className="cmd-hero">
          <div className="cmd-hero-copy">
            <div className="eyebrow">Behavioral operations center</div>
            <h2 className="cmd-title">Integration Outcomes, Verified Live</h2>
            <p className="muted">Real-time business-outcome assurance across every connected service. A 200 OK does not prove success.</p>
            <div className="cmd-hero-stats">
              <div><span className="cmd-hero-num">{summary?.totalInvariants ?? '—'}</span><span className="muted"> invariants</span></div>
              <div><span className="cmd-hero-num">{openCount}</span><span className="muted"> open incidents</span></div>
            </div>
          </div>
          <div className="globe" aria-hidden="true">
            <div className="globe-sphere" />
            <div className="globe-ring r1" />
            <div className="globe-ring r2" />
            <div className="globe-sat s1" />
            <div className="globe-sat s2" />
            <div className="globe-sat s3" />
          </div>
        </div>
      )}
      <div className="tiles">
        {tiles.map(t => (
          <div key={t.label} className="card tile">
            <div className="table-label">{t.label}</div>
            <div className="tile-num">{t.value}</div>
            <div className="tile-delta">{t.delta}</div>
          </div>
        ))}
      </div>
      {command && drift.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>Drift activity</h3><span className="table-label">recent checks</span></div>
          <div className="bars">
            {drift.map(d => (
              <div
                key={d.id}
                className={`bar ${d.detected ? 'hit' : ''}`}
                style={{ height: `${18 + Math.min(82, Math.abs(Number(d.effectSize)) * 60)}px` }}
                title={`p=${Number(d.pValue).toFixed(4)} d=${Number(d.effectSize).toFixed(2)}`}
              />
            ))}
          </div>
        </div>
      )}
      <div className="grid">
        <div className="card">
          <div className="card-head"><h3>Behavioral health</h3><Badge text="MONITORING" tone="green" /></div>
          <p className="muted">A 200 OK does not prove success. Invariants assert business outcomes.</p>
          <div className="stats">
            <div><div className="stat-num">{summary?.totalInvariants ?? '—'}</div><div className="stat-label">Invariants</div></div>
            <div><div className="stat-num">{summary?.monitoredIntegrations ?? '—'}</div><div className="stat-label">Monitored integrations</div></div>
            <div><div className="stat-num">{summary?.activeAlerts ?? '—'}</div><div className="stat-label">Active drift alerts (24h)</div></div>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Latest incidents</h3><span className="table-label">Recent activity</span></div>
          {incidents.length === 0 && <p className="muted">No incidents. Trigger the demo SaaS failure to see one.</p>}
          {incidents.map(i => (
            <div key={i.id} className="row">
              <Badge text={i.status} tone={toneFor(i.status)} />
              <Badge text={i.severity} tone={toneFor(i.severity)} />
              <span>{i.title}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Integrations({ refreshKey, bump }: { refreshKey: number; bump: () => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [name, setName] = useState('Stripe Payments');
  const [type, setType] = useState('STRIPE');
  const [webhookInfo, setWebhookInfo] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api<any>('/integrations?pageSize=50');
      setItems(res.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <div className="card">
      <div className="card-head"><h3>Integrations</h3><span className="table-label">{items.length} connected</span></div>
      {error && <div className="card error">Load failed: {error}</div>}
      <div className="form-row">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" />
        <select value={type} onChange={e => setType(e.target.value)}>
          <option>STRIPE</option><option>GITHUB</option><option>SENDGRID</option><option>TWILIO</option><option>CUSTOM</option>
        </select>
        <button onClick={async () => {
          try {
            setError(null);
            await api('/integrations', { method: 'POST', body: JSON.stringify({ name, type, config: {} }) });
            setName('');
            bump();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}>Add</button>
        <button className="secondary" onClick={() => void load()}>Refresh</button>
      </div>
      {items.map(i => (
        <div key={i.id} className="row">
          <Badge text={i.type} tone="gray" />
          <strong>{i.name}</strong>
          <span className="muted mono">{i.id.slice(0, 8)}</span>
          <button className="secondary" onClick={async () => {
            try {
              setError(null);
              const info = await api(`/integrations/${i.id}/webhook-url`);
              setWebhookInfo(info);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}>Webhook URL</button>
        </div>
      ))}
      {webhookInfo && (
        <pre className="code">{JSON.stringify(webhookInfo, null, 2)}</pre>
      )}
    </div>
  );
}

function Invariants({ refreshKey, bump }: { refreshKey: number; bump: () => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [form, setForm] = useState({ integrationId: '', name: '', predicateExpression: "event.type === 'invoice.payment_succeeded' && event.payload && event.payload.data && event.payload.data.object && event.payload.data.object.amount_paid > 0", predicateDescription: '', repairRepository: '', repairFilePath: '', repairRequiredChecks: '' });
  const [error, setError] = useState<string | null>(null);
  const [evalResult, setEvalResult] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [inv, integ] = await Promise.all([
        api<any>('/invariants?pageSize=50'),
        api<any>('/integrations?pageSize=50'),
      ]);
      setItems(inv.data ?? []);
      setIntegrations(integ.data ?? []);
      if (!form.integrationId && integ.data?.[0]) setForm(f => ({ ...f, integrationId: integ.data[0].id }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const clearMappingEditor = () => {
    setEditingId(null);
    setForm(f => ({ ...f, repairRepository: '', repairFilePath: '', repairRequiredChecks: '' }));
  };

  const editMapping = (invariant: any) => {
    setEditingId(invariant.id);
    setForm(f => ({
      ...f,
      integrationId: invariant.integrationId,
      name: invariant.name,
      predicateExpression: invariant.predicateExpression,
      predicateDescription: invariant.predicateDescription ?? '',
      repairRepository: invariant.repairRepository ?? '',
      repairFilePath: invariant.repairFilePath ?? '',
      repairRequiredChecks: (invariant.repairRequiredChecks ?? []).join(', '),
    }));
    setError(null);
  };

  const saveMapping = async () => {
    if (!editingId) return;
    try {
      setError(null);
      await api(`/invariants/${editingId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          repairRepository: form.repairRepository.trim() || null,
          repairFilePath: form.repairFilePath.trim() || null,
          repairRequiredChecks: form.repairRequiredChecks.split(',').map(check => check.trim()).filter(Boolean),
        }),
      });
      clearMappingEditor();
      bump();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="card">
      <div className="card-head"><h3>Behavioral invariants</h3><span className="table-label">{items.length} defined</span></div>
      <p className="muted section-note">Executable predicates over webhook events. Core abstraction of SHAPI.</p>
      {error && <div className="card error">Load failed: {error}</div>}
      {evalResult && <div className="card"><span className="mono">{evalResult}</span></div>}
      <div className="form-col">
        <div className="form-row">
          <select value={form.integrationId} onChange={e => setForm({ ...form, integrationId: e.target.value })}>
            {integrations.map(i => <option key={i.id} value={i.id}>{i.name} ({i.type})</option>)}
          </select>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Invariant name" />
        </div>
        <input value={form.predicateExpression} onChange={e => setForm({ ...form, predicateExpression: e.target.value })} placeholder="predicate expression" className="mono" />
        <input value={form.predicateDescription} onChange={e => setForm({ ...form, predicateDescription: e.target.value })} placeholder="human description" />
        <div className="mapping-fields">
          <div className="table-label">Repair target mapping (optional)</div>
          <div className="form-row">
            <input value={form.repairRepository} onChange={e => setForm({ ...form, repairRepository: e.target.value })} placeholder="owner/repository" />
            <input value={form.repairFilePath} onChange={e => setForm({ ...form, repairFilePath: e.target.value })} placeholder="repository file path" />
            <input value={form.repairRequiredChecks} onChange={e => setForm({ ...form, repairRequiredChecks: e.target.value })} placeholder="required checks, comma-separated" />
          </div>
          <p className="muted">A mapped target enables safe source previews. Required checks must all pass before a repair is verified.</p>
        </div>
        <div><button onClick={editingId ? () => void saveMapping() : async () => {
          try {
            setError(null);
            await api('/invariants', { method: 'POST', body: JSON.stringify({ ...form, description: form.predicateDescription, repairRepository: form.repairRepository.trim() || null, repairFilePath: form.repairFilePath.trim() || null, repairRequiredChecks: form.repairRequiredChecks.split(',').map(check => check.trim()).filter(Boolean) }) });
            bump();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}>{editingId ? 'Save repair mapping' : 'Create invariant'}</button>{editingId && <button className="secondary" onClick={clearMappingEditor}>Cancel</button>}</div>
      </div>
      {items.map(i => (
        <div key={i.id} className="row">
          <Badge text={i.status} tone={toneFor(i.status)} />
          <strong>{i.name}</strong>
          <span className="muted mono">{i.predicateExpression.slice(0, 80)}</span>
          <span className="muted">{i.repairRepository ? `${i.repairRepository}/${i.repairFilePath}` : 'manual repair'}</span>
          <button className="secondary" onClick={() => editMapping(i)}>Edit target</button>
          <button className="secondary" onClick={async () => {
            try {
              setError(null);
              const res = await api(`/invariants/${i.id}/evaluate`, { method: 'POST', body: JSON.stringify({}) });
              setEvalResult(`Evaluated ${i.name}: ${JSON.stringify(res).slice(0, 300)}`);
              bump();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}>Evaluate</button>
        </div>
      ))}
    </div>
  );
}

function Incidents({ refreshKey, bump }: { refreshKey: number; bump: () => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [installations, setInstallations] = useState<any[]>([]);
  const [preview, setPreview] = useState<any>(null);
  const [previewCandidate, setPreviewCandidate] = useState<any>(null);
  const [previewApproved, setPreviewApproved] = useState(false);
  const [prTitle, setPrTitle] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [res, nextInstallations] = await Promise.all([
      api<any>('/incidents?pageSize=50'),
      api<any[]>('/github/installations'),
    ]);
    setItems(res.data ?? []);
    setInstallations(nextInstallations);
  }, []);

  useEffect(() => {
    load().catch((e) => setActionError(e instanceof Error ? e.message : String(e)));
  }, [load, refreshKey]);

  const open = async (id: string) => {
    try {
      setActionError(null);
      const [detail, tl] = await Promise.all([
        api<any>(`/incidents/${id}`),
        api<any>(`/incidents/${id}/timeline`),
      ]);
      setSelected(detail);
      setTimeline(tl.timeline ?? []);
      setPreview(null);
      setPreviewCandidate(null);
      setPreviewApproved(false);
      setPrTitle('');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  const findInstallation = (candidate: any) => installations.find(installation =>
    candidate.repository && installation.repositories?.includes(candidate.repository),
  );

  const previewRepair = async (candidate: any) => {
    const installation = findInstallation(candidate);
    if (!installation || !candidate.repository) {
      setActionError('This candidate is not mapped to an accessible GitHub installation and repository.');
      return;
    }
    try {
      setBusy(`preview:${candidate.id}`);
      setActionError(null);
      const result = await api<any>(`/github/incidents/${selected.id}/pr/preview`, {
        method: 'POST',
        body: JSON.stringify({
          installationId: installation.id,
          repository: candidate.repository,
          candidateId: candidate.id,
        }),
      });
      setPreview({ ...result, installationId: installation.id });
      setPreviewCandidate(candidate);
      setPreviewApproved(false);
      setPrTitle(`Repair ${selected.title}`.slice(0, 256));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const createRepairPr = async () => {
    if (!preview || !previewCandidate || !previewApproved || !prTitle.trim()) return;
    try {
      setBusy('create-pr');
      setActionError(null);
      await api(`/github/incidents/${selected.id}/pr`, {
        method: 'POST',
        body: JSON.stringify({
          installationId: preview.installationId,
          repository: preview.repository,
          candidateId: previewCandidate.id,
          title: prTitle.trim(),
          base: preview.base,
          previewToken: preview.previewToken,
        }),
      });
      setPreview(null);
      setPreviewCandidate(null);
      setPreviewApproved(false);
      bump();
      await open(selected.id);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const verifyPr = async (pr: any) => {
    try {
      setBusy(`verify:${pr.id}`);
      setActionError(null);
      await api(`/github/prs/${pr.id}/verify`, { method: 'POST' });
      bump();
      await open(selected.id);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid-2">
      <div className="card">
        <h3>Incidents</h3>
        <button className="secondary" onClick={load}>Refresh</button>
        {items.map(i => (
          <div key={i.id} className="row clickable" onClick={() => open(i.id)}>
            <Badge text={i.status} tone={toneFor(i.status)} />
            <Badge text={i.severity} tone={toneFor(i.severity)} />
            <span>{i.title}</span>
          </div>
        ))}
        {items.length === 0 && <p className="muted">No incidents yet.</p>}
      </div>
      <div className="card">
        <h3>Detail</h3>
        {!selected && <p className="muted">Select an incident.</p>}
        {selected && (
          <>
            <h4>{selected.title}</h4>
            <p>{selected.description}</p>
            {selected.rootCause && <p><strong>Root cause:</strong> {selected.rootCause}</p>}
            {selected.suggestedFix && <p><strong>Suggested fix:</strong> {selected.suggestedFix}</p>}
            {actionError && <div className="card error">Action failed: {actionError}</div>}
            <div className="form-row">
              <button disabled={busy !== null} onClick={async () => {
                try {
                  setBusy('diagnose');
                  setActionError(null);
                  const res = await api(`/incidents/${selected.id}/diagnose`, { method: 'POST' });
                  setSelected((res as any).incident);
                  bump();
                  await open(selected.id);
                } catch (e) {
                  setActionError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(null);
                }
              }}>{busy === 'diagnose' ? 'Diagnosing…' : 'Diagnose + suggest repairs'}</button>
            </div>
            {selected.repairCandidates?.length > 0 && (
              <>
                <h4>Repair candidates</h4>
                {selected.repairCandidates.map((r: any) => (
                  <div key={r.id} className="row">
                    <Badge text={r.verified ? 'VERIFIED' : r.type} tone={r.verified ? 'green' : 'gray'} />
                    <span>{r.description} ({Math.round(r.confidence * 100)}%)</span>
                    {r.repository && r.changes && <button className="secondary" disabled={busy !== null} onClick={() => void previewRepair(r)}>{busy === `preview:${r.id}` ? 'Loading preview…' : 'Preview repair'}</button>}
                  </div>
                ))}
              </>
            )}
            {selected.githubPRs?.length > 0 && (
              <>
                <h4>GitHub repair PRs</h4>
                {selected.githubPRs.map((pr: any) => (
                  <div key={pr.id} className="pr-proof-card">
                    <div className="row">
                      <Badge text={pr.verified ? 'VERIFIED' : pr.status} tone={pr.verified ? 'green' : toneFor(pr.status)} />
                      <span>#{pr.prNumber} {pr.title}</span>
                      <a href={pr.prUrl} target="_blank" rel="noreferrer">Open GitHub</a>
                      <button className="secondary" disabled={busy !== null} onClick={() => void verifyPr(pr)}>{busy === `verify:${pr.id}` ? 'Checking…' : 'Verify now'}</button>
                    </div>
                    {pr.verificationHeadSha && <div className="proof-meta mono">Verified head: {pr.verificationHeadSha}</div>}
                    {Array.isArray(pr.verificationChecks) && pr.verificationChecks.length > 0 && (
                      <details className="verification-proof">
                        <summary>Verification evidence ({pr.verificationChecks.length} checks)</summary>
                        {pr.verificationChecks.map((check: any, index: number) => (
                          <div key={`${check.name ?? 'check'}-${index}`} className="proof-check">
                            <Badge text={check.conclusion === 'success' ? 'PASS' : String(check.conclusion ?? check.status ?? 'UNKNOWN')} tone={check.conclusion === 'success' ? 'green' : 'red'} />
                            <span>{check.name ?? 'Unnamed check'}</span>
                            {check.completedAt && <span className="muted">{new Date(check.completedAt).toLocaleString()}</span>}
                          </div>
                        ))}
                      </details>
                    )}
                  </div>
                ))}
              </>
            )}
            {preview && previewCandidate && (
              <div className="repair-panel">
                <div className="card-head"><h4>Repair preview</h4><Badge text="PINNED BASE" tone="gray" /></div>
                <p className="muted">{preview.repository} · {preview.base} · {preview.baseSha.slice(0, 12)}</p>
                {preview.changes.map((change: any) => (
                  <div key={change.path} className="diff-block">
                    <div className="mono diff-path">{change.path} · {change.kind}</div>
                    <div className="diff-grid">
                      <pre className="diff-before">{change.before?.text ?? '(new file)'}</pre>
                      <pre className="diff-after">{change.after?.text ?? '(deleted)'}</pre>
                    </div>
                  </div>
                ))}
                <input value={prTitle} onChange={e => setPrTitle(e.target.value)} placeholder="Pull request title" maxLength={256} />
                <label className="confirm-row"><input type="checkbox" checked={previewApproved} onChange={e => setPreviewApproved(e.target.checked)} /> I reviewed this exact patch and approve opening the PR.</label>
                <button disabled={busy !== null || !previewApproved || !prTitle.trim()} onClick={() => void createRepairPr()}>{busy === 'create-pr' ? 'Opening PR…' : 'Open repair PR'}</button>
              </div>
            )}
            <h4>Timeline</h4>
            {timeline.map((t, idx) => (
              <div key={idx} className="row"><span className="muted mono">{new Date(t.timestamp).toLocaleTimeString()}</span><span>{t.message}</span></div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function Drift({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<any>('/drift/results?pageSize=20')
      .then(r => { if (!cancelled) { setRows(r.data ?? []); setError(null); } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [refreshKey]);
  return (
    <div className="card">
      <div className="card-head"><h3>Drift results</h3><span className="table-label">{rows.length} checks</span></div>
      {error && <div className="card error">Load failed: {error}</div>}
      {rows.map(r => (
        <div key={r.id} className="row">
          <Badge text={r.detected ? 'DRIFT' : 'OK'} tone={r.detected ? 'red' : 'green'} />
          <span className="mono">p={Number(r.pValue).toFixed(4)} d={Number(r.effectSize).toFixed(2)} base={(Number(r.baselineRate) * 100).toFixed(1)}% cur={(Number(r.currentRate) * 100).toFixed(1)}%</span>
          <span className="muted">{new Date(r.detectedAt).toLocaleString()}</span>
        </div>
      ))}
      {rows.length === 0 && <p className="muted">No drift results yet.</p>}
    </div>
  );
}

function Events({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<any>('/sdk/events?pageSize=20')
      .then(r => { if (!cancelled) { setRows(r.data ?? []); setError(null); } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [refreshKey]);
  return (
    <div className="card">
      <div className="card-head"><h3>SDK tracked events</h3><span className="table-label">{rows.length} events</span></div>
      {error && <div className="card error">Load failed: {error}</div>}
      {rows.map(e => (
        <div key={e.id} className="row">
          <Badge text={e.integration} tone="gray" />
          <span className="mono">{e.type}</span>
          <span className="muted mono">{e.correlationId?.slice(0, 8) ?? ''}</span>
        </div>
      ))}
      {rows.length === 0 && <p className="muted">No SDK events yet. Use the demo SaaS app to generate some.</p>}
    </div>
  );
}

type GitHubStatus = {
  mode: string;
  message: string;
  appCredentialsConfigured: boolean;
  tokenConfigured: boolean;
  webhookConfigured: boolean;
  realInstallations: number;
  installationCount: number;
  repositoryCount: number;
  appInstallUrl: string | null;
};

function GitHub({ refreshKey }: { refreshKey: number }) {
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [installations, setInstallations] = useState<any[]>([]);
  const [installationId, setInstallationId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [nextStatus, nextInstallations] = await Promise.all([
        api<GitHubStatus>('/github/status'),
        api<any[]>('/github/installations'),
      ]);
      setStatus(nextStatus);
      setInstallations(nextInstallations);
      if (!installationId && nextInstallations[0]?.githubInstallationId) {
        setInstallationId(String(nextInstallations[0].githubInstallationId));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [installationId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(timer);
  }, [load, refreshKey]);

  const sync = async () => {
    const value = installationId.trim();
    if (!value) return;
    try {
      setLoading(true);
      setError(null);
      setNotice(null);
      await api('/github/installations/sync', {
        method: 'POST',
        body: JSON.stringify({ githubInstallationId: value }),
      });
      setNotice(`Installation ${value} synced successfully.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="card">
        <div className="card-head">
          <h3>GitHub App connection</h3>
          <Badge text={status?.mode ?? 'CHECKING'} tone={status?.mode === 'app' ? 'green' : 'amber'} />
        </div>
        {error && <div className="card error">Load failed: {error}</div>}
        {notice && <div className="card success">{notice}</div>}
        <p className="muted section-note">This is the connection SHAPI uses to read repositories and create verified repair pull requests.</p>
        <div className="stats">
          <div><div className="stat-num">{status?.appCredentialsConfigured ? 'READY' : '—'}</div><div className="stat-label">App credentials</div></div>
          <div><div className="stat-num">{status?.webhookConfigured ? 'READY' : '—'}</div><div className="stat-label">Webhook</div></div>
          <div><div className="stat-num">{status?.repositoryCount ?? '—'}</div><div className="stat-label">Accessible repositories</div></div>
        </div>
        <p className="muted">{status?.message ?? 'Loading GitHub status…'}</p>
        {status?.appInstallUrl && (
          <div className="form-row">
            <a className="secondary button-link" href={status.appInstallUrl} target="_blank" rel="noreferrer">
              Install or change repository access
            </a>
            <span className="muted">Use this when a new repository or organization needs access.</span>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head"><h3>Installations</h3><span className="table-label">{installations.length} registered</span></div>
        <p className="muted section-note">If GitHub delivered an installation before SHAPI was listening, enter its ID once to recover the repository access.</p>
        <div className="form-row">
          <input value={installationId} onChange={e => setInstallationId(e.target.value)} placeholder="GitHub installation ID" inputMode="numeric" />
          <button onClick={() => void sync()} disabled={loading || !installationId.trim()}>{loading ? 'Syncing…' : 'Sync installation'}</button>
          <button className="secondary" onClick={() => void load()}>Refresh</button>
        </div>
        {installations.map(item => (
          <div key={item.id} className="row">
            <Badge text={Number(item.githubInstallationId) > 0 ? 'APP' : 'TOKEN'} tone={Number(item.githubInstallationId) > 0 ? 'green' : 'gray'} />
            <strong>{item.accountLogin}</strong>
            <span className="muted">{item.repositories?.length ?? 0} repositories</span>
            <span className="mono">{String(item.githubInstallationId)}</span>
            <span className="muted">{item._count?.prs ?? 0} repair PRs</span>
          </div>
        ))}
        {installations.length === 0 && <p className="muted">No GitHub installations registered yet.</p>}
      </div>
    </div>
  );
}

function ApiKeys({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<any[]>([]);
  const [name, setName] = useState('Dashboard key');
  const [permissions, setPermissions] = useState('read,write');
  const [role, setRole] = useState('OPERATOR');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setRows(await api<any[]>('/api-keys'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const create = async () => {
    try {
      setError(null);
      const result = await api<any>('/api-keys', {
        method: 'POST',
        body: JSON.stringify({ name, permissions: permissions.split(','), role }),
      });
      setNewKey(result.key);
      setName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="card">
      <div className="card-head"><h3>API keys</h3><span className="table-label">{rows.length} keys</span></div>
      <p className="muted section-note">Create scoped credentials for SDKs, operators, and automation. Raw keys are shown once.</p>
      {error && <div className="card error">Action failed: {error}</div>}
      {newKey && (
        <div className="card code">
          <strong>Copy this key now</strong>
          <div className="mono">{newKey}</div>
          <button className="secondary" onClick={() => setNewKey(null)}>Dismiss</button>
        </div>
      )}
      <div className="form-row">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Key name" />
        <select value={permissions} onChange={e => setPermissions(e.target.value)}>
          <option value="read">Read only</option>
          <option value="read,write">Read + write</option>
          <option value="*">Full access</option>
        </select>
        <select value={role} onChange={e => setRole(e.target.value)}>
          <option value="OWNER">Owner</option>
          <option value="ADMIN">Admin</option>
          <option value="OPERATOR">Operator</option>
          <option value="VIEWER">Viewer</option>
        </select>
        <button onClick={() => void create()} disabled={!name.trim()}>Create key</button>
        <button className="secondary" onClick={() => void load()}>Refresh</button>
      </div>
      {rows.map(key => (
        <div key={key.id} className="row">
          <strong>{key.name}</strong>
          <span className="mono">{key.prefix}…</span>
          <Badge text={key.permissions.join(', ')} tone="gray" />
          <Badge text={key.role ?? 'OPERATOR'} tone="gray" />
          <span className="muted">{key.expiresAt ? 'expires ' + new Date(key.expiresAt).toLocaleDateString() : 'no expiry'}</span>
          <button className="secondary" onClick={async () => {
            try {
              setError(null);
              await api('/api-keys/' + key.id, { method: 'DELETE' });
              await load();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}>Revoke</button>
        </div>
      ))}
      {rows.length === 0 && <p className="muted">No API keys found.</p>}
    </div>
  );
}

type Theme = 'navy' | 'white' | 'command';
const THEMES: Theme[] = ['navy', 'white', 'command'];
const THEME_LABEL: Record<Theme, string> = { navy: '● Navy', white: '○ White', command: '◈ Command' };

export default function App() {
  const [authState, setAuthState] = useState<'checking' | 'authenticated' | 'login'>(API_KEY ? 'authenticated' : 'checking');
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [oidcEnabled, setOidcEnabled] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [refreshKey, setRefreshKey] = useState(0);
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem('shapi-theme');
      if (saved === 'white' || saved === 'command' || saved === 'navy') return saved;
    } catch {
      // storage unavailable — fall through to default
    }
    return 'navy';
  });
  const bump = useCallback(() => setRefreshKey(k => k + 1), []);
  useEffect(() => {
    if (API_KEY) return;
    let cancelled = false;
    (async () => {
      try {
        const [meResponse, configResponse] = await Promise.all([
          fetch(`${API}/auth/me`, { credentials: 'include' }),
          fetch(`${API}/auth/config`, { credentials: 'include' }),
        ]);
        const authConfig = await configResponse.json() as { oidcEnabled?: boolean };
        if (!cancelled) setOidcEnabled(Boolean(authConfig.oidcEnabled));
        if (meResponse.ok) {
          const body = await meResponse.json() as { user: AuthUser };
          if (!cancelled) { setAuthUser(body.user); setAuthState('authenticated'); }
        } else if (!cancelled) {
          setAuthState('login');
        }
      } catch {
        if (!cancelled) setAuthState('login');
      }
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.shapiTheme = theme;
    try {
      localStorage.setItem('shapi-theme', theme);
    } catch {
      // storage unavailable (private mode) — theme still applies for the session
    }
  }, [theme]);
  if (authState === 'checking') return <div className="auth-shell"><div className="card auth-card">Checking your SHAPI session…</div></div>;
  if (authState === 'login') return <LoginScreen oidcEnabled={oidcEnabled} />;
  const labels: Record<Tab, string> = { overview: 'Overview', integrations: 'Integrations', invariants: 'Invariants', incidents: 'Incidents', drift: 'Drift monitoring', events: 'Event stream', github: 'GitHub operations', keys: 'API keys' };
  const icons: Record<Tab, string> = { overview: '◫', integrations: '⌘', invariants: '◈', incidents: '⚑', drift: '⌁', events: '≋', github: '◉', keys: '⚿' };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">S</span><span>SHAPI</span></div>
        <div className="nav-label">Workspace</div>
        <nav className="side-nav">
          {(['overview', 'integrations', 'invariants', 'incidents', 'drift', 'events', 'github', 'keys'] as Tab[]).map(t => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}><span className="nav-icon">{icons[t]}</span>{labels[t]}</button>
          ))}
        </nav>
        <div className="sidebar-footer"><strong>Behavioral assurance</strong>Making every integration outcome visible.</div>
      </aside>
      <div className="workspace">
      <div className="topbar"><div className="crumb">SHAPI <span aria-hidden="true">/</span> <strong>{labels[tab]}</strong></div><div className="top-actions"><button className="secondary theme-toggle" onClick={() => setTheme(t => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length])} title="Cycle theme">{THEME_LABEL[theme]}</button><span className="live"><span className="live-dot" /> SYSTEM LIVE</span><span className="avatar">{authUser?.name?.slice(0, 2).toUpperCase() ?? 'SA'}</span>{authUser && <button className="secondary" onClick={async () => { await api('/auth/logout', { method: 'POST' }); window.location.reload(); }}>Sign out</button>}</div></div>
      <main>
        <div className="page-heading"><div><div className="eyebrow">WEBHOOK RELIABILITY PLATFORM</div><h1>{tab === 'overview' ? 'Good morning' : labels[tab]}</h1><p className="subtitle">{tab === 'overview' ? 'Know when integrations succeed in business—not just in HTTP.' : `Manage and monitor your ${labels[tab].toLowerCase()} across connected services.`}</p></div>{tab === 'overview' && <button className="secondary" onClick={bump}>↻ &nbsp; Refresh data</button>}</div>
        {tab === 'overview' && <Overview refreshKey={refreshKey} command={theme === 'command'} />}
        {tab === 'integrations' && <Integrations refreshKey={refreshKey} bump={bump} />}
        {tab === 'invariants' && <Invariants refreshKey={refreshKey} bump={bump} />}
        {tab === 'incidents' && <Incidents refreshKey={refreshKey} bump={bump} />}
        {tab === 'drift' && <Drift refreshKey={refreshKey} />}
        {tab === 'events' && <Events refreshKey={refreshKey} />}
        {tab === 'github' && <GitHub refreshKey={refreshKey} />}
        {tab === 'keys' && <ApiKeys refreshKey={refreshKey} />}
      </main>
      </div>
    </div>
  );
}
