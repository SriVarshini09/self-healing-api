import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { fetchShapi } from '@/lib/shapi-api';

type RunStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'ERROR';

type OutcomeCheck = {
  id: string;
  integrationId: string;
  name: string;
  description: string;
  triggerEventType: string;
  sql: string;
  paramBindings: Record<string, string>;
  deadlineSec: number;
  database: string;
  stripeConnected: boolean;
  enabled: boolean;
  lastReconciledAt: string | null;
  lastError: string | null;
  invariantId: string;
  runsLast24h?: Record<RunStatus, number>;
};

type OutcomeRun = {
  id: string;
  sourceEventId: string;
  source: 'WEBHOOK' | 'RECONCILE';
  params: Record<string, unknown>;
  dueAt: string;
  status: RunStatus;
  checkedAt: string | null;
  detail: string | null;
};

type IntegrationOption = { id: string; name: string; type: string };

const TRIGGERS = [
  'invoice.payment_succeeded',
  'invoice.paid',
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
];

const EXAMPLE_SQL =
  "SELECT 1 FROM users WHERE stripe_customer_id = :customer AND plan_status = 'active'";

// Where each common parameter lives in a Stripe event, per trigger.
function suggestBinding(param: string, trigger: string): string {
  const subscriptionEvent = trigger.startsWith('customer.subscription.');
  const suggestions: Record<string, string> = {
    customer: 'data.object.customer',
    customer_id: 'data.object.customer',
    subscription: subscriptionEvent ? 'data.object.id' : 'data.object.subscription',
    subscription_id: subscriptionEvent ? 'data.object.id' : 'data.object.subscription',
    status: 'data.object.status',
    email: trigger === 'checkout.session.completed' ? 'data.object.customer_details.email' : 'data.object.customer_email',
    user_id: 'data.object.client_reference_id',
    userId: 'data.object.client_reference_id',
    invoice: 'data.object.id',
    product: subscriptionEvent ? 'data.object.items.data.0.plan.product' : 'data.object.lines.data.0.price.product',
  };
  return suggestions[param] ?? 'data.object.';
}

/** Same parameter rule as the backend: :name, not ::cast, ignoring quoted text. */
function sqlParams(sql: string): string[] {
  const unquoted = sql.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
  const names: string[] = [];
  for (const match of unquoted.matchAll(/(?<![:\w]):([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

function sampleEvent(trigger: string): string {
  const object = trigger.startsWith('customer.subscription.')
    ? { id: 'sub_123', object: 'subscription', customer: 'cus_123', status: trigger.endsWith('deleted') ? 'canceled' : 'active', items: { data: [{ plan: { product: 'prod_123' } }] } }
    : trigger === 'checkout.session.completed'
      ? { id: 'cs_123', object: 'checkout.session', customer: 'cus_123', subscription: 'sub_123', client_reference_id: '1', customer_details: { email: 'customer@example.com' } }
      : { id: 'in_123', object: 'invoice', customer: 'cus_123', subscription: 'sub_123', customer_email: 'customer@example.com', amount_paid: 4900, status: 'paid' };
  return JSON.stringify({ id: 'evt_test', type: trigger, data: { object } }, null, 2);
}

const inputClass =
  'w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-[11px] outline-none focus:border-primary';
const labelClass = 'block text-[10px] font-medium uppercase tracking-wide text-muted-foreground';

function statusClass(status: RunStatus): string {
  return status === 'PASSED'
    ? 'bg-success/15 text-success'
    : status === 'FAILED'
      ? 'bg-critical/15 text-critical'
      : status === 'ERROR'
        ? 'bg-warning/15 text-warning'
        : 'bg-secondary text-muted-foreground';
}

function CreateCheckForm({ integrations, onCreated }: { integrations: IntegrationOption[]; onCreated: () => void }) {
  const [integrationId, setIntegrationId] = useState('');
  const [name, setName] = useState('Paid customers are provisioned');
  const [trigger, setTrigger] = useState(TRIGGERS[0]);
  const [sql, setSql] = useState(EXAMPLE_SQL);
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [deadlineSec, setDeadlineSec] = useState(300);
  const [databaseUrl, setDatabaseUrl] = useState('');
  const [stripeKey, setStripeKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const params = useMemo(() => sqlParams(sql), [sql]);
  const selectedIntegration = integrationId || integrations.find(item => item.type === 'STRIPE')?.id || integrations[0]?.id || '';
  const bindingFor = (param: string) => bindings[param] ?? suggestBinding(param, trigger);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await fetchShapi('outcome-checks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          integrationId: selectedIntegration,
          name,
          triggerEventType: trigger,
          sql,
          paramBindings: Object.fromEntries(params.map(param => [param, bindingFor(param)])),
          deadlineSec,
          databaseUrl,
          ...(stripeKey.trim() ? { stripeApiKey: stripeKey.trim() } : {}),
        }),
      });
      // Secrets leave the browser once; never keep them in form state.
      setDatabaseUrl('');
      setStripeKey('');
      onCreated();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not create the check');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={event => void submit(event)} className="mt-3 grid gap-3 rounded border border-border bg-secondary/30 p-3 md:grid-cols-2">
      <label className="space-y-1">
        <span className={labelClass}>Integration</span>
        <select className={inputClass} value={selectedIntegration} onChange={event => setIntegrationId(event.target.value)}>
          {integrations.map(item => (
            <option key={item.id} value={item.id}>{item.name} ({item.type})</option>
          ))}
        </select>
      </label>
      <label className="space-y-1">
        <span className={labelClass}>Name</span>
        <input className={inputClass} value={name} onChange={event => setName(event.target.value)} required maxLength={200} />
      </label>
      <label className="space-y-1">
        <span className={labelClass}>After this Stripe event</span>
        <input className={inputClass} list="outcome-trigger-options" value={trigger} onChange={event => setTrigger(event.target.value)} required />
        <datalist id="outcome-trigger-options">
          {TRIGGERS.map(item => <option key={item} value={item} />)}
        </datalist>
      </label>
      <label className="space-y-1">
        <span className={labelClass}>Must be true within (seconds)</span>
        <input className={inputClass} type="number" min={30} max={86400} value={deadlineSec} onChange={event => setDeadlineSec(Number(event.target.value))} required />
      </label>
      <label className="space-y-1 md:col-span-2">
        <span className={labelClass}>This query returns a row (your database, read-only)</span>
        <textarea className={`${inputClass} min-h-20`} value={sql} onChange={event => setSql(event.target.value)} required spellCheck={false} />
        <span className="block text-[10px] text-muted-foreground">
          A single SELECT. Use <code>:name</code> for values taken from the Stripe event. Runs in a read-only transaction with a 5 s timeout; only "a row exists" is observed.
        </span>
      </label>
      {params.length > 0 && (
        <div className="space-y-1 md:col-span-2">
          <span className={labelClass}>Where each parameter comes from in the event</span>
          {params.map(param => (
            <div key={param} className="flex items-center gap-2">
              <code className="w-28 shrink-0 font-mono text-[11px] text-primary">:{param}</code>
              <input className={inputClass} value={bindingFor(param)} onChange={event => setBindings(current => ({ ...current, [param]: event.target.value }))} required />
            </div>
          ))}
        </div>
      )}
      <label className="space-y-1">
        <span className={labelClass}>Database URL (read-only role recommended)</span>
        <input className={inputClass} type="password" autoComplete="off" placeholder="postgresql://readonly:…@host:5432/app" value={databaseUrl} onChange={event => setDatabaseUrl(event.target.value)} required />
      </label>
      <label className="space-y-1">
        <span className={labelClass}>Stripe restricted key (optional)</span>
        <input className={inputClass} type="password" autoComplete="off" placeholder="rk_live_… with read access to Events" value={stripeKey} onChange={event => setStripeKey(event.target.value)} />
        <span className="block text-[10px] text-muted-foreground">Lets SHAPI pull events from Stripe every 15 minutes, so no webhook setup is needed.</span>
      </label>
      {error && <p className="rounded border border-critical/30 bg-critical/5 p-2 text-[10px] text-critical md:col-span-2">{error}</p>}
      <div className="flex items-center gap-2 md:col-span-2">
        <Button type="submit" size="sm" disabled={saving || !selectedIntegration}>{saving ? 'Saving…' : 'Create check'}</Button>
        <span className="text-[10px] text-muted-foreground">The database URL and key are encrypted at rest and never shown again.</span>
      </div>
    </form>
  );
}

function CheckRow({ check, onChanged }: { check: OutcomeCheck; onChanged: () => void }) {
  const [open, setOpen] = useState<'test' | 'runs' | 'delete' | null>(null);
  const [eventJson, setEventJson] = useState(() => sampleEvent(check.triggerEventType));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad' | 'info'; text: string } | null>(null);
  const [runs, setRuns] = useState<OutcomeRun[]>([]);
  const counts = check.runsLast24h;

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (actionError) {
      setMessage({ tone: 'bad', text: actionError instanceof Error ? actionError.message : 'Request failed' });
    } finally {
      setBusy(false);
    }
  };

  const runTest = () => act(async () => {
    let event: unknown;
    try {
      event = JSON.parse(eventJson);
    } catch {
      throw new Error('The sample event is not valid JSON');
    }
    const result = await fetchShapi<{ matched: boolean; rowCount: number; durationMs: number; params: Record<string, unknown> }>(
      `outcome-checks/${check.id}/test`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event }) },
    );
    setMessage(result.matched
      ? { tone: 'ok', text: `Outcome found (${result.durationMs} ms) for ${JSON.stringify(result.params)}.` }
      : { tone: 'bad', text: `No row for ${JSON.stringify(result.params)}: this customer would be reported as paid but not provisioned.` });
  });

  const reconcile = () => act(async () => {
    const result = await fetchShapi<{ eventsSeen: number; runsQueued: number; processed: { passed: number; failed: number; errors: number } }>(
      `outcome-checks/${check.id}/reconcile`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sinceHours: 24 }) },
    );
    setMessage({ tone: result.processed.failed ? 'bad' : 'info', text: `Stripe: ${result.eventsSeen} events in 24h, ${result.runsQueued} new. Checked now: ${result.processed.passed} passed, ${result.processed.failed} failed, ${result.processed.errors} errors.` });
    onChanged();
  });

  const loadRuns = () => act(async () => {
    const response = await fetchShapi<{ data: OutcomeRun[] }>(`outcome-checks/${check.id}/runs?limit=20`);
    setRuns(response.data);
  });

  const toggleEnabled = () => act(async () => {
    await fetchShapi(`outcome-checks/${check.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: !check.enabled }),
    });
    onChanged();
  });

  const remove = () => act(async () => {
    await fetchShapi(`outcome-checks/${check.id}`, { method: 'DELETE' });
    onChanged();
  });

  const toggle = (panel: 'test' | 'runs' | 'delete') => {
    const next = open === panel ? null : panel;
    setOpen(next);
    setMessage(null);
    if (next === 'runs') void loadRuns();
  };

  return (
    <div className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`size-2 shrink-0 rounded-full ${!check.enabled ? 'bg-muted-foreground' : check.lastError ? 'bg-warning' : counts?.FAILED ? 'bg-critical' : 'bg-success'}`} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{check.name}{!check.enabled && <span className="ml-2 text-[10px] text-muted-foreground">(paused)</span>}</p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">
            {check.triggerEventType} → row within {check.deadlineSec}s · {check.database} · {check.stripeConnected ? 'Stripe connected' : 'webhooks only'}
          </p>
        </div>
        {counts && (
          <span className="font-mono text-[10px] text-muted-foreground">
            24h: <span className="text-success">{counts.PASSED} ok</span> · <span className={counts.FAILED ? 'text-critical' : ''}>{counts.FAILED} failed</span>
            {counts.ERROR ? <> · <span className="text-warning">{counts.ERROR} errors</span></> : null}
            {counts.PENDING ? <> · {counts.PENDING} waiting</> : null}
          </span>
        )}
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" onClick={() => toggle('test')}>{open === 'test' ? 'Hide test' : 'Test'}</Button>
          {check.stripeConnected && <Button variant="outline" size="sm" onClick={() => void reconcile()} disabled={busy}>Check last 24h</Button>}
          <Button variant="outline" size="sm" onClick={() => toggle('runs')}>{open === 'runs' ? 'Hide runs' : 'Runs'}</Button>
          <Button variant="outline" size="sm" onClick={() => void toggleEnabled()} disabled={busy}>{check.enabled ? 'Pause' : 'Resume'}</Button>
          <Button variant="outline" size="sm" onClick={() => toggle('delete')}>Delete</Button>
        </div>
      </div>
      {check.lastError && (
        <p className="mt-1.5 rounded border border-warning/30 bg-warning/5 p-1.5 font-mono text-[10px] text-warning">Last error: {check.lastError}</p>
      )}
      {open === 'test' && (
        <div className="mt-2 rounded border border-border bg-secondary/30 p-2">
          <p className="text-[10px] text-muted-foreground">Paste a real Stripe event (or edit the customer id) and run the query now. Nothing is stored.</p>
          <textarea className={`${inputClass} mt-1 min-h-32`} value={eventJson} onChange={event => setEventJson(event.target.value)} spellCheck={false} />
          <Button className="mt-2" size="sm" onClick={() => void runTest()} disabled={busy}>{busy ? 'Running…' : 'Run query'}</Button>
        </div>
      )}
      {open === 'runs' && (
        <div className="mt-2 rounded border border-border bg-secondary/30 p-2 text-[10px]">
          {runs.length ? (
            <div className="divide-y divide-border">
              {runs.map(run => (
                <div key={run.id} className="flex flex-wrap items-center gap-2 py-1.5">
                  <span className={`rounded px-1.5 py-0.5 font-mono uppercase ${statusClass(run.status)}`}>{run.status}</span>
                  <span className="font-mono text-muted-foreground">{run.source.toLowerCase()} · {run.sourceEventId}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{JSON.stringify(run.params)}</span>
                  <time className="font-mono text-muted-foreground" dateTime={run.checkedAt ?? run.dueAt}>
                    {run.checkedAt ? new Date(run.checkedAt).toLocaleString() : `due ${new Date(run.dueAt).toLocaleTimeString()}`}
                  </time>
                  {run.detail && <span className="basis-full text-muted-foreground">{run.detail}</span>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">{busy ? 'Loading…' : 'No runs yet. Runs appear after the next matching Stripe event.'}</p>
          )}
        </div>
      )}
      {open === 'delete' && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-critical/30 bg-critical/5 p-2 text-[10px]">
          <span className="flex-1 text-critical">Delete this check, its run history and its invariant? Open incidents are kept.</span>
          <Button variant="destructive" size="sm" onClick={() => void remove()} disabled={busy}>Delete check</Button>
          <Button variant="outline" size="sm" onClick={() => setOpen(null)}>Cancel</Button>
        </div>
      )}
      {message && (
        <p className={`mt-2 rounded border p-2 text-[10px] ${message.tone === 'ok' ? 'border-success/30 bg-success/5 text-success' : message.tone === 'bad' ? 'border-critical/30 bg-critical/5 text-critical' : 'border-border bg-secondary/30 text-muted-foreground'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}

export function OutcomeChecksPanel() {
  const [checks, setChecks] = useState<OutcomeCheck[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [checkResponse, integrationResponse] = await Promise.all([
        fetchShapi<{ data: OutcomeCheck[] }>('outcome-checks'),
        fetchShapi<{ data: IntegrationOption[] }>('integrations?pageSize=100'),
      ]);
      setChecks(checkResponse.data ?? []);
      setIntegrations(integrationResponse.data ?? []);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load outcome checks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <section id="outcome-checks" className="mt-3.5 rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Outcome checks</h2>
          <p className="mt-1 max-w-2xl text-[11px] text-muted-foreground">
            After each Stripe payment, SHAPI asks your own database whether the customer actually got access. No SDK, no code changes. A paid customer with no matching row opens an incident.
          </p>
        </div>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Button>
          <Button size="sm" onClick={() => setCreating(current => !current)} disabled={!integrations.length}>
            {creating ? 'Close' : 'New check'}
          </Button>
        </div>
      </div>
      {creating && (
        <CreateCheckForm
          integrations={integrations}
          onCreated={() => {
            setCreating(false);
            void load();
          }}
        />
      )}
      {error ? (
        <p className="mt-3 rounded border border-critical/30 bg-critical/5 p-2 text-[10px] text-critical">{error}</p>
      ) : checks.length ? (
        <div className="mt-3 divide-y divide-border">
          {checks.map(check => <CheckRow key={check.id} check={check} onChanged={() => void load()} />)}
        </div>
      ) : (
        !loading && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            No outcome checks yet. Create one: pick the Stripe event, write the query that proves the customer was provisioned, and connect a read-only database URL.
          </p>
        )
      )}
    </section>
  );
}
