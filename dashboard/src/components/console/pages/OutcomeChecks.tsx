import { useMemo, useState, type FormEvent } from 'react';
import { ListChecks } from 'lucide-react';
import { Card, Empty, ErrorNote, PageHeader, Pill, errorMessage, label, sendJson, statusTone, useShapi } from '../ui';
import type { Integration, OutcomeCheck, OutcomeRun } from '../types';
import { fetchShapi } from '@/lib/shapi-api';

const TRIGGERS = [
  'invoice.payment_succeeded',
  'invoice.paid',
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
];

const EXAMPLE_SQL = "SELECT 1 FROM users WHERE stripe_customer_id = :customer AND plan_status = 'active'";

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
    ? { id: 'sub_123', customer: 'cus_123', status: trigger.endsWith('deleted') ? 'canceled' : 'active', items: { data: [{ plan: { product: 'prod_123' } }] } }
    : trigger === 'checkout.session.completed'
      ? { id: 'cs_123', customer: 'cus_123', subscription: 'sub_123', client_reference_id: '1', customer_details: { email: 'customer@example.com' } }
      : { id: 'in_123', customer: 'cus_123', subscription: 'sub_123', customer_email: 'customer@example.com', amount_paid: 4900, status: 'paid' };
  return JSON.stringify({ id: 'evt_test', type: trigger, data: { object } }, null, 2);
}

export function OutcomeChecksPage() {
  const checks = useShapi<{ data: OutcomeCheck[] }>('outcome-checks', 30_000);
  const integrations = useShapi<{ data: Integration[] }>('integrations?pageSize=100');
  const [creating, setCreating] = useState(false);
  const list = checks.data?.data ?? [];

  return (
    <div className="c-page">
      <PageHeader
        title="Outcome checks"
        icon={<ListChecks />}
        tint="mint"
        sub="After each Stripe event, SHAPI asks your own database whether the customer actually got access. No SDK, no code changes."
        actions={
          <>
            <button className="c-btn" onClick={() => void checks.reload()}>Refresh</button>
            <button className="c-btn is-primary" onClick={() => setCreating(value => !value)} disabled={!integrations.data?.data.length}>
              {creating ? 'Cancel' : 'New check'}
            </button>
          </>
        }
      />
      {creating && (
        <CreateCheckForm
          integrations={integrations.data?.data ?? []}
          onCreated={() => { setCreating(false); void checks.reload(); }}
        />
      )}
      <ErrorNote error={checks.error} />
      <Card>
        {list.length ? (
          <div className="c-list">
            {list.map(check => <CheckRow key={check.id} check={check} onChanged={() => void checks.reload()} />)}
          </div>
        ) : (
          <Empty>
            {checks.loading && !checks.data
              ? 'Loading…'
              : 'No outcome checks yet. Create one: pick the Stripe event, write the query that proves the customer was provisioned, and connect a read-only database URL.'}
          </Empty>
        )}
      </Card>
    </div>
  );
}

function CreateCheckForm({ integrations, onCreated }: { integrations: Integration[]; onCreated: () => void }) {
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
  const selected = integrationId || integrations.find(item => item.type === 'STRIPE')?.id || integrations[0]?.id || '';
  const bindingFor = (param: string) => bindings[param] ?? suggestBinding(param, trigger);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await sendJson('outcome-checks', 'POST', {
        integrationId: selected,
        name,
        triggerEventType: trigger,
        sql,
        paramBindings: Object.fromEntries(params.map(param => [param, bindingFor(param)])),
        deadlineSec,
        databaseUrl,
        ...(stripeKey.trim() ? { stripeApiKey: stripeKey.trim() } : {}),
      });
      // Secrets leave the browser once; never keep them in form state.
      setDatabaseUrl('');
      setStripeKey('');
      onCreated();
    } catch (saveError) {
      setError(errorMessage(saveError, 'Could not create the check'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="New outcome check" tint="mint">
      <form className="c-card-body c-form" onSubmit={event => void submit(event)}>
        <label className="c-field">
          <span className="c-label">Name</span>
          <input className="c-input" value={name} onChange={event => setName(event.target.value)} required maxLength={200} />
        </label>
        <label className="c-field">
          <span className="c-label">Integration</span>
          <select className="c-select" value={selected} onChange={event => setIntegrationId(event.target.value)}>
            {integrations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="c-field">
          <span className="c-label">After this Stripe event</span>
          <input className="c-input" list="c-trigger-options" value={trigger} onChange={event => setTrigger(event.target.value)} required />
          <datalist id="c-trigger-options">{TRIGGERS.map(item => <option key={item} value={item} />)}</datalist>
        </label>
        <label className="c-field">
          <span className="c-label">Within (seconds)</span>
          <input className="c-input" type="number" min={30} max={86400} value={deadlineSec} onChange={event => setDeadlineSec(Number(event.target.value))} required />
        </label>
        <label className="c-field c-span-2">
          <span className="c-label">This query must return a row</span>
          <textarea className="c-textarea" value={sql} onChange={event => setSql(event.target.value)} required spellCheck={false} />
          <span className="c-hint">One SELECT against your database. Use <code>:name</code> for values from the Stripe event. It runs read-only with a 5-second limit, and SHAPI only learns whether a row exists.</span>
        </label>
        {params.length > 0 && (
          <div className="c-field c-span-2">
            <span className="c-label">Where each value comes from in the event</span>
            {params.map(param => (
              <div key={param} className="c-row">
                <code style={{ width: 120 }}>:{param}</code>
                <input className="c-input c-grow" value={bindingFor(param)} onChange={event => setBindings(current => ({ ...current, [param]: event.target.value }))} required />
              </div>
            ))}
          </div>
        )}
        <label className="c-field">
          <span className="c-label">Database URL</span>
          <input className="c-input" type="password" autoComplete="off" placeholder="postgresql://readonly:…@host:5432/app" value={databaseUrl} onChange={event => setDatabaseUrl(event.target.value)} required />
          <span className="c-hint">Use a read-only database user.</span>
        </label>
        <label className="c-field">
          <span className="c-label">Stripe restricted key (optional)</span>
          <input className="c-input" type="password" autoComplete="off" placeholder="rk_live_…" value={stripeKey} onChange={event => setStripeKey(event.target.value)} />
          <span className="c-hint">With read access to Events, SHAPI pulls payments from Stripe itself, so no webhook setup is needed.</span>
        </label>
        {error && <p className="c-note is-bad c-span-2">{error}</p>}
        <div className="c-row c-span-2">
          <button className="c-btn is-primary" type="submit" disabled={saving || !selected}>{saving ? 'Saving…' : 'Create check'}</button>
          <span className="c-hint">The database URL and key are encrypted and never shown again.</span>
        </div>
      </form>
    </Card>
  );
}

function CheckRow({ check, onChanged }: { check: OutcomeCheck; onChanged: () => void }) {
  const [panel, setPanel] = useState<'test' | 'runs' | 'delete' | null>(null);
  const [eventJson, setEventJson] = useState(() => sampleEvent(check.triggerEventType));
  const [runs, setRuns] = useState<OutcomeRun[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null);
  const counts = check.runsLast24h;

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (error) {
      setMessage({ tone: 'bad', text: errorMessage(error, 'Request failed') });
    } finally {
      setBusy(false);
    }
  };

  const open = (next: 'test' | 'runs' | 'delete') => {
    const value = panel === next ? null : next;
    setPanel(value);
    setMessage(null);
    if (value === 'runs') void act(async () => setRuns((await fetchShapi<{ data: OutcomeRun[] }>(`outcome-checks/${check.id}/runs?limit=20`)).data));
  };

  const test = () => act(async () => {
    let event: unknown;
    try {
      event = JSON.parse(eventJson);
    } catch {
      throw new Error('The sample event is not valid JSON.');
    }
    const result = await sendJson<{ matched: boolean; durationMs: number; params: Record<string, unknown> }>(`outcome-checks/${check.id}/test`, 'POST', { event });
    setMessage(result.matched
      ? { tone: 'ok', text: `Found: ${JSON.stringify(result.params)} has the expected row (${result.durationMs} ms).` }
      : { tone: 'bad', text: `Not found: ${JSON.stringify(result.params)} would be reported as paid but not provisioned.` });
  });

  const backfill = () => act(async () => {
    const result = await sendJson<{ eventsSeen: number; runsQueued: number; processed: { passed: number; failed: number; errors: number } }>(`outcome-checks/${check.id}/reconcile`, 'POST', { sinceHours: 24 });
    setMessage({ tone: result.processed.failed ? 'bad' : 'ok', text: `${result.eventsSeen} Stripe events in the last 24h (${result.runsQueued} new): ${result.processed.passed} passed, ${result.processed.failed} failed, ${result.processed.errors} errors.` });
    onChanged();
  });

  const toggle = () => act(async () => {
    await sendJson(`outcome-checks/${check.id}`, 'PATCH', { enabled: !check.enabled });
    onChanged();
  });

  const remove = () => act(async () => {
    await sendJson(`outcome-checks/${check.id}`, 'DELETE');
    onChanged();
  });

  return (
    <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="c-row">
        <div className="c-grow">
          <div className="c-strong">{check.name} {!check.enabled && <Pill>Paused</Pill>}</div>
          <div className="c-muted c-small c-truncate">
            After <code>{check.triggerEventType}</code>, within {check.deadlineSec}s · {check.database} · {check.stripeConnected ? 'Stripe connected' : 'webhooks only'}
          </div>
        </div>
        <Pill tone="ok">{counts?.PASSED ?? 0} ok</Pill>
        <Pill tone={counts?.FAILED ? 'bad' : 'neutral'}>{counts?.FAILED ?? 0} failed</Pill>
        {counts?.ERROR ? <Pill tone="warn">{counts.ERROR} errors</Pill> : null}
      </div>
      <div className="c-row">
        <button className="c-btn" onClick={() => open('test')}>Test</button>
        {check.stripeConnected && <button className="c-btn" onClick={() => void backfill()} disabled={busy}>Check last 24h</button>}
        <button className="c-btn" onClick={() => open('runs')}>History</button>
        <button className="c-btn" onClick={() => void toggle()} disabled={busy}>{check.enabled ? 'Pause' : 'Resume'}</button>
        <button className="c-btn is-quiet" onClick={() => open('delete')}>Delete</button>
      </div>
      {check.lastError && <p className="c-note is-warn">Last error: {check.lastError}</p>}
      {panel === 'test' && (
        <div className="c-field">
          <span className="c-hint">Paste a real Stripe event, or change the customer id, and run the query now. Nothing is saved.</span>
          <textarea className="c-textarea" style={{ minHeight: 160 }} value={eventJson} onChange={event => setEventJson(event.target.value)} spellCheck={false} />
          <div><button className="c-btn is-primary" onClick={() => void test()} disabled={busy}>{busy ? 'Running…' : 'Run query'}</button></div>
        </div>
      )}
      {panel === 'runs' && (
        runs?.length ? (
          <div className="c-table-wrap c-card">
            <table className="c-table">
              <thead><tr><th>Result</th><th>Event</th><th>Values</th><th>Checked</th></tr></thead>
              <tbody>
                {runs.map(run => (
                  <tr key={run.id}>
                    <td><Pill tone={statusTone(run.status)}>{label(run.status)}</Pill></td>
                    <td className="c-small"><code>{run.sourceEventId}</code> <span className="c-muted">({run.source.toLowerCase()})</span></td>
                    <td className="c-small"><code>{JSON.stringify(run.params)}</code>{run.detail && <div className="c-muted">{run.detail}</div>}</td>
                    <td className="c-muted c-small">{run.checkedAt ? new Date(run.checkedAt).toLocaleString() : `due ${new Date(run.dueAt).toLocaleTimeString()}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="c-note">{busy ? 'Loading…' : 'No runs yet. They appear after the next matching Stripe event.'}</p>
        )
      )}
      {panel === 'delete' && (
        <div className="c-note is-bad c-row">
          <span className="c-grow">Delete this check and its history? Existing incidents are kept.</span>
          <button className="c-btn is-danger" onClick={() => void remove()} disabled={busy}>Delete</button>
          <button className="c-btn" onClick={() => setPanel(null)}>Cancel</button>
        </div>
      )}
      {message && <p className={`c-note is-${message.tone}`}>{message.text}</p>}
    </div>
  );
}
