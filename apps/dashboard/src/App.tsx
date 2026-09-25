import { useCallback, useEffect, useState } from 'react';
import './App.css';

const API = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001/api/v1';
// Dev default matches the seeded local key; set VITE_SHAPI_API_KEY for real envs.
const API_KEY = (import.meta as any).env?.VITE_SHAPI_API_KEY || 'shapi_demo_local_d3v_k3y_9f2c';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { 'content-type': 'application/json', 'x-api-key': API_KEY },
    ...init,
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

function toneFor(status: string): string {
  const s = status.toUpperCase();
  if (['HEALTHY', 'RESOLVED', 'MERGED', 'COMPLETED'].includes(s)) return 'green';
  if (['DEGRADED', 'TRIAGED', 'REPLAYING', 'OPEN', 'RECEIVED'].includes(s)) return 'amber';
  if (['VIOLATED', 'DETECTED', 'FAILED', 'CRITICAL', 'HIGH'].includes(s)) return 'red';
  return 'gray';
}

function Overview({ refreshKey }: { refreshKey: number }) {
  const [summary, setSummary] = useState<any>(null);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, inc] = await Promise.all([
          api<any>('/drift/summary'),
          api<any>('/incidents?pageSize=5'),
        ]);
        if (!cancelled) {
          setSummary(s);
          setIncidents(inc.data ?? []);
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

  return (
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
  );
}

function Integrations({ refreshKey, bump }: { refreshKey: number; bump: () => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [name, setName] = useState('Stripe Payments');
  const [type, setType] = useState('STRIPE');
  const [webhookInfo, setWebhookInfo] = useState<any>(null);

  const load = useCallback(async () => {
    const res = await api<any>('/integrations?pageSize=50');
    setItems(res.data ?? []);
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load, refreshKey]);

  return (
    <div className="card">
      <h3>Integrations</h3>
      <div className="form-row">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" />
        <select value={type} onChange={e => setType(e.target.value)}>
          <option>STRIPE</option><option>GITHUB</option><option>SENDGRID</option><option>TWILIO</option><option>CUSTOM</option>
        </select>
        <button onClick={async () => {
          await api('/integrations', { method: 'POST', body: JSON.stringify({ name, type, config: {} }) });
          setName('');
          bump();
        }}>Add</button>
        <button className="secondary" onClick={load}>Refresh</button>
      </div>
      {items.map(i => (
        <div key={i.id} className="row">
          <Badge text={i.type} tone="gray" />
          <strong>{i.name}</strong>
          <span className="muted mono">{i.id.slice(0, 8)}</span>
          <button className="secondary" onClick={async () => {
            const info = await api(`/integrations/${i.id}/webhook-url`);
            setWebhookInfo(info);
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

  const load = useCallback(async () => {
    const [inv, integ] = await Promise.all([
      api<any>('/invariants?pageSize=50'),
      api<any>('/integrations?pageSize=50'),
    ]);
    setItems(inv.data ?? []);
    setIntegrations(integ.data ?? []);
    if (!form.integrationId && integ.data?.[0]) setForm(f => ({ ...f, integrationId: integ.data[0].id }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load().catch(() => undefined);
  }, [load, refreshKey]);

  return (
    <div className="card">
      <h3>Behavioral invariants</h3>
      <p className="muted">Executable predicates over webhook events. Core abstraction of SHAPI.</p>
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
          await api('/invariants', { method: 'POST', body: JSON.stringify({ ...form, description: form.predicateDescription }) });
          bump();
        }}>Create invariant</button></div>
      </div>
      {items.map(i => (
        <div key={i.id} className="row">
          <Badge text={i.status} tone={toneFor(i.status)} />
          <strong>{i.name}</strong>
          <span className="muted mono">{i.predicateExpression.slice(0, 80)}</span>
          <button className="secondary" onClick={async () => {
            const res = await api(`/invariants/${i.id}/evaluate`, { method: 'POST', body: JSON.stringify({}) });
            alert(`Evaluated: ${JSON.stringify(res)}`);
            bump();
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

  const load = useCallback(async () => {
    const res = await api<any>('/incidents?pageSize=50');
    setItems(res.data ?? []);
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load, refreshKey]);

  const open = async (id: string) => {
    const [detail, tl] = await Promise.all([
      api<any>(`/incidents/${id}`),
      api<any>(`/incidents/${id}/timeline`),
    ]);
    setSelected(detail);
    setTimeline(tl.timeline ?? []);
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
            <div className="form-row">
              <button onClick={async () => {
                const res = await api(`/incidents/${selected.id}/diagnose`, { method: 'POST' });
                setSelected((res as any).incident);
                bump();
                await open(selected.id);
              }}>Diagnose + suggest repairs</button>
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
  useEffect(() => {
    api<any>('/drift/results?pageSize=20').then(r => setRows(r.data ?? [])).catch(() => undefined);
  }, [refreshKey]);
  return (
    <div className="card">
      <h3>Drift results</h3>
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
  useEffect(() => {
    api<any>('/sdk/events?pageSize=20').then(r => setRows(r.data ?? [])).catch(() => undefined);
  }, [refreshKey]);
  return (
    <div className="card">
      <h3>SDK tracked events</h3>
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

export default function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey(k => k + 1), []);
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
      <div className="topbar"><div className="crumb">SHAPI <span aria-hidden="true">/</span> <strong>{labels[tab]}</strong></div><div className="top-actions"><span className="live"><span className="live-dot" /> SYSTEM LIVE</span><span className="avatar">SA</span></div></div>
      <main>
        <div className="page-heading"><div><div className="eyebrow">WEBHOOK RELIABILITY PLATFORM</div><h1>{tab === 'overview' ? 'Good morning' : labels[tab]}</h1><p className="subtitle">{tab === 'overview' ? 'Know when integrations succeed in business—not just in HTTP.' : `Manage and monitor your ${labels[tab].toLowerCase()} across connected services.`}</p></div>{tab === 'overview' && <button className="secondary" onClick={bump}>↻ &nbsp; Refresh data</button>}</div>
        {tab === 'overview' && <Overview refreshKey={refreshKey} />}
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
