import { useCallback, useEffect, useState } from 'react';
import './App.css';

const API = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001/api/v1';
// Dev default matches the seeded local key; set VITE_SHAPI_API_KEY for real envs.
const API_KEY = (import.meta as any).env?.VITE_SHAPI_API_KEY || 'shapi_demo_local_d3v_k3y_9f2c';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined && init?.body !== null;
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      'x-api-key': API_KEY,
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

type Tab = 'overview' | 'integrations' | 'invariants' | 'incidents' | 'drift' | 'events';

function Badge({ text, tone }: { text: string; tone: string }) {
  return <span className={`badge ${tone}`}>{text}</span>;
}

export function toneFor(status: string): string {
  const s = status.toUpperCase();
  if (['HEALTHY', 'RESOLVED', 'MERGED', 'COMPLETED'].includes(s)) return 'green';
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
  const [form, setForm] = useState({ integrationId: '', name: '', predicateExpression: "event.type === 'invoice.payment_succeeded' && event.payload && event.payload.data && event.payload.data.object && event.payload.data.object.amount_paid > 0", predicateDescription: '' });
  const [error, setError] = useState<string | null>(null);
  const [evalResult, setEvalResult] = useState<string | null>(null);

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
        <div><button onClick={async () => {
          try {
            setError(null);
            await api('/invariants', { method: 'POST', body: JSON.stringify({ ...form, description: form.predicateDescription }) });
            bump();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}>Create invariant</button></div>
      </div>
      {items.map(i => (
        <div key={i.id} className="row">
          <Badge text={i.status} tone={toneFor(i.status)} />
          <strong>{i.name}</strong>
          <span className="muted mono">{i.predicateExpression.slice(0, 80)}</span>
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
  const [actionError, setActionError] = useState<string | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);

  const load = useCallback(async () => {
    const res = await api<any>('/incidents?pageSize=50');
    setItems(res.data ?? []);
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
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
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
              <button disabled={diagnosing} onClick={async () => {
                try {
                  setDiagnosing(true);
                  setActionError(null);
                  const res = await api(`/incidents/${selected.id}/diagnose`, { method: 'POST' });
                  setSelected((res as any).incident);
                  bump();
                  await open(selected.id);
                } catch (e) {
                  setActionError(e instanceof Error ? e.message : String(e));
                } finally {
                  setDiagnosing(false);
                }
              }}>{diagnosing ? 'Diagnosing…' : 'Diagnose + suggest repairs'}</button>
            </div>
            {selected.repairCandidates?.length > 0 && (
              <>
                <h4>Repair candidates</h4>
                {selected.repairCandidates.map((r: any) => (
                  <div key={r.id} className="row">
                    <Badge text={r.verified ? 'VERIFIED' : r.type} tone={r.verified ? 'green' : 'gray'} />
                    <span>{r.description} ({Math.round(r.confidence * 100)}%)</span>
                  </div>
                ))}
              </>
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

type Theme = 'navy' | 'white' | 'command';
const THEMES: Theme[] = ['navy', 'white', 'command'];
const THEME_LABEL: Record<Theme, string> = { navy: '● Navy', white: '○ White', command: '◈ Command' };

export default function App() {
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
    document.documentElement.dataset.shapiTheme = theme;
    try {
      localStorage.setItem('shapi-theme', theme);
    } catch {
      // storage unavailable (private mode) — theme still applies for the session
    }
  }, [theme]);
  const labels: Record<Tab, string> = { overview: 'Overview', integrations: 'Integrations', invariants: 'Invariants', incidents: 'Incidents', drift: 'Drift monitoring', events: 'Event stream' };
  const icons: Record<Tab, string> = { overview: '◫', integrations: '⌘', invariants: '◈', incidents: '⚑', drift: '⌁', events: '≋' };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">S</span><span>SHAPI</span></div>
        <div className="nav-label">Workspace</div>
        <nav className="side-nav">
          {(['overview', 'integrations', 'invariants', 'incidents', 'drift', 'events'] as Tab[]).map(t => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}><span className="nav-icon">{icons[t]}</span>{labels[t]}</button>
          ))}
        </nav>
        <div className="sidebar-footer"><strong>Behavioral assurance</strong>Making every integration outcome visible.</div>
      </aside>
      <div className="workspace">
      <div className="topbar"><div className="crumb">SHAPI <span aria-hidden="true">/</span> <strong>{labels[tab]}</strong></div><div className="top-actions"><button className="secondary theme-toggle" onClick={() => setTheme(t => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length])} title="Cycle theme">{THEME_LABEL[theme]}</button><span className="live"><span className="live-dot" /> SYSTEM LIVE</span><span className="avatar">SA</span></div></div>
      <main>
        <div className="page-heading"><div><div className="eyebrow">WEBHOOK RELIABILITY PLATFORM</div><h1>{tab === 'overview' ? 'Good morning' : labels[tab]}</h1><p className="subtitle">{tab === 'overview' ? 'Know when integrations succeed in business—not just in HTTP.' : `Manage and monitor your ${labels[tab].toLowerCase()} across connected services.`}</p></div>{tab === 'overview' && <button className="secondary" onClick={bump}>↻ &nbsp; Refresh data</button>}</div>
        {tab === 'overview' && <Overview refreshKey={refreshKey} command={theme === 'command'} />}
        {tab === 'integrations' && <Integrations refreshKey={refreshKey} bump={bump} />}
        {tab === 'invariants' && <Invariants refreshKey={refreshKey} bump={bump} />}
        {tab === 'incidents' && <Incidents refreshKey={refreshKey} bump={bump} />}
        {tab === 'drift' && <Drift refreshKey={refreshKey} />}
        {tab === 'events' && <Events refreshKey={refreshKey} />}
      </main>
      </div>
    </div>
  );
}
