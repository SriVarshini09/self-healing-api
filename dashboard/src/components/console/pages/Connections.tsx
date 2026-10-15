import { useEffect, useState, type FormEvent } from 'react';
import { Cable } from 'lucide-react';
import { fetchShapi } from '@/lib/shapi-api';
import { Card, Empty, ErrorNote, PageHeader, Pill, errorMessage, label, sendJson, statusTone, useShapi } from '../ui';
import { StripeChangesCard } from './StripeChanges';
import type { GitHubStatus, Integration } from '../types';

type WebhookSetup = { webhookUrl: string; webhookSecretConfigured: boolean; instructions: string };
type Delivery = { id: string; eventType: string; providerEventId?: string | null; status: string; receivedAt: string };
type AlertStatus = { webhookConfigured: boolean; destinations?: number; pending: number; retrying: number; delivered: number; failed: number };

export function ConnectionsPage() {
  const integrations = useShapi<{ data: Integration[] }>('integrations?pageSize=100');
  const github = useShapi<GitHubStatus>('github/status');
  const alerts = useShapi<AlertStatus>('alerts/status');
  const list = integrations.data?.data ?? [];
  const [adding, setAdding] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  return (
    <div className="c-page">
      <PageHeader
        title="Connections"
        icon={<Cable />}
        tint="teal"
        sub="Where SHAPI receives events from, and where it sends repairs and alerts."
        actions={
          <>
            <button className="c-btn" onClick={() => { void integrations.reload(); void github.reload(); void alerts.reload(); }}>Refresh</button>
            <button className="c-btn is-primary" onClick={() => setAdding(value => !value)}>{adding ? 'Cancel' : 'Add connection'}</button>
          </>
        }
      />
      <ErrorNote error={integrations.error} />
      {adding && (
        <AddConnection onCreated={id => { setAdding(false); setJustAdded(id); void integrations.reload(); }} />
      )}
      <Card title="Integrations" tint="teal" sub="Providers that send events to SHAPI.">
        {list.length ? (
          <div className="c-list">
            {list.map(item => (
              <IntegrationRow key={item.id} integration={item} startOpen={item.id === justAdded} onChanged={() => void integrations.reload()} />
            ))}
          </div>
        ) : (
          <Empty>{integrations.loading && !integrations.data ? 'Loading…' : 'No connections yet. Add Stripe to start checking payments.'}</Empty>
        )}
      </Card>

      <StripeChangesCard />

      <div className="c-grid-2">
        <Card title="GitHub" tint="lavender" sub="Optional. Used to open reviewed repair pull requests.">
          <div className="c-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {github.data && github.data.mode !== 'app' && github.data.mode !== 'token' ? (
              // Operator setup details (simulation, tokens) mean nothing to a customer.
              <>
                <div><Pill>Not connected</Pill></div>
                <p className="c-muted c-small" style={{ margin: 0 }}>
                  Not needed to catch problems. SHAPI's incidents and diagnosis tell you what broke and where to fix it.
                  Repair pull requests are coming later.
                </p>
              </>
            ) : github.data ? (
              <>
                <div className="c-row">
                  <Pill tone={github.data.mode === 'app' ? 'ok' : github.data.mode === 'unconfigured' ? 'bad' : 'warn'}>
                    {github.data.mode === 'app' ? 'GitHub App connected' : github.data.mode === 'unconfigured' ? 'Not connected' : label(github.data.mode)}
                  </Pill>
                  <span className="c-muted c-small">
                    {github.data.repositoryCount} repositor{github.data.repositoryCount === 1 ? 'y' : 'ies'} · webhook {github.data.webhookConfigured ? 'ready' : 'not set'}
                  </span>
                </div>
                <p className="c-muted c-small" style={{ margin: 0 }}>{github.data.message}</p>
                {github.data.appInstallUrl && (
                  <div><a className="c-btn" href={github.data.appInstallUrl} target="_blank" rel="noreferrer">Install on a repository</a></div>
                )}
              </>
            ) : (
              <p className="c-muted" style={{ margin: 0 }}>{github.error ?? 'Loading…'}</p>
            )}
          </div>
        </Card>

        <Card title="Alerts" tint="peach" sub="Where incidents are sent.">
          <div className="c-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {alerts.data ? (
              <>
                <div><Pill tone={(alerts.data.destinations ?? 0) > 0 || alerts.data.webhookConfigured ? 'ok' : 'neutral'}>{(alerts.data.destinations ?? 0) > 0 ? `${alerts.data.destinations} destination${alerts.data.destinations === 1 ? '' : 's'}` : alerts.data.webhookConfigured ? 'Alert webhook set' : 'No destinations yet'}</Pill></div>
                <div className="c-row c-small">
                  <span>{alerts.data.delivered} delivered</span>
                  <span className="c-muted">·</span>
                  <span>{alerts.data.pending + alerts.data.retrying} waiting</span>
                  <span className="c-muted">·</span>
                  <span className={alerts.data.failed ? '' : 'c-muted'} style={alerts.data.failed ? { color: 'var(--c-bad)' } : undefined}>{alerts.data.failed} failed</span>
                </div>
                <p className="c-muted c-small" style={{ margin: 0 }}>Add or test Slack and email destinations in <a href="#/settings">Settings</a>.</p>
              </>
            ) : (
              <p className="c-muted" style={{ margin: 0 }}>{alerts.error ?? 'Loading…'}</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

const PROVIDERS = [
  { type: 'STRIPE', label: 'Stripe' },
  { type: 'GITHUB', label: 'GitHub' },
  { type: 'SENDGRID', label: 'SendGrid' },
  { type: 'TWILIO', label: 'Twilio' },
  { type: 'CUSTOM', label: 'Custom webhook' },
];

function AddConnection({ onCreated }: { onCreated: (id: string) => void }) {
  const [type, setType] = useState('STRIPE');
  const [name, setName] = useState('Stripe');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await sendJson<{ id: string }>('integrations', 'POST', { name: name.trim(), type });
      onCreated(created.id);
    } catch (createError) {
      setError(errorMessage(createError, 'Could not add the connection'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Add connection">
      <form className="c-card-body c-form" onSubmit={event => void submit(event)}>
        <label className="c-field">
          <span className="c-label">Provider</span>
          <select
            className="c-select"
            value={type}
            onChange={event => {
              const next = event.target.value;
              setType(next);
              setName(PROVIDERS.find(provider => provider.type === next)?.label ?? name);
            }}
          >
            {PROVIDERS.map(provider => <option key={provider.type} value={provider.type}>{provider.label}</option>)}
          </select>
        </label>
        <label className="c-field">
          <span className="c-label">Name</span>
          <input className="c-input" value={name} onChange={event => setName(event.target.value)} required maxLength={200} />
        </label>
        {error && <p className="c-note is-bad c-span-2">{error}</p>}
        <div className="c-row c-span-2">
          <button className="c-btn is-primary" type="submit" disabled={busy || !name.trim()}>{busy ? 'Adding…' : 'Add connection'}</button>
          <span className="c-hint">Next you get the webhook URL to paste into the provider. For Stripe the webhook is optional if an outcome check uses a restricted key.</span>
        </div>
      </form>
    </Card>
  );
}

function IntegrationRow({ integration, startOpen = false, onChanged }: { integration: Integration; startOpen?: boolean; onChanged: () => void }) {
  const [panel, setPanel] = useState<'setup' | 'deliveries' | null>(null);
  const [secret, setSecret] = useState('');
  const [savingSecret, setSavingSecret] = useState(false);
  const [secretMessage, setSecretMessage] = useState<string | null>(null);

  const [setup, setSetup] = useState<WebhookSetup | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const received = (integration._count?.webhookEvents ?? 0) > 0;

  const open = async (next: 'setup' | 'deliveries') => {
    if (panel === next) { setPanel(null); return; }
    setPanel(next);
    setError(null);
    try {
      if (next === 'setup') setSetup(await fetchShapi<WebhookSetup>(`integrations/${integration.id}/webhook-url`));
      else setDeliveries((await fetchShapi<{ data: Delivery[] }>(`integrations/${integration.id}/webhook-events?pageSize=5`)).data ?? []);
    } catch (loadError) {
      setError(errorMessage(loadError, 'Could not load'));
    }
  };

  // A just-added connection opens its setup straight away.
  useEffect(() => {
    if (startOpen) void open('setup');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startOpen]);

  const saveSecret = async (event: FormEvent) => {
    event.preventDefault();
    setSavingSecret(true);
    setSecretMessage(null);
    try {
      await sendJson(`integrations/${integration.id}`, 'PATCH', { webhookSecret: secret.trim() });
      setSecret('');
      setSecretMessage('Signing secret saved.');
      setSetup(current => (current ? { ...current, webhookSecretConfigured: true } : current));
      onChanged();
    } catch (saveError) {
      setSecretMessage(errorMessage(saveError, 'Could not save the secret'));
    } finally {
      setSavingSecret(false);
    }
  };

  return (
    <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="c-row">
        <div className="c-grow">
          <div className="c-strong">{integration.name}</div>
          <div className="c-muted c-small">
            {label(integration.type)} · {integration._count?.invariants ?? 0} rules · {integration._count?.incidents ?? 0} incidents
          </div>
        </div>
        <Pill tone={received ? 'ok' : 'warn'}>{received ? 'Receiving' : 'No events yet'}</Pill>
        <button className="c-btn" onClick={() => void open('setup')}>Setup</button>
        <button className="c-btn" onClick={() => void open('deliveries')}>Deliveries</button>
      </div>
      <ErrorNote error={error} />
      {panel === 'setup' && setup && (
        <div className="c-note" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="c-strong">Webhook endpoint</span>
          <code style={{ wordBreak: 'break-all' }}>{setup.webhookUrl}</code>
          <span style={{ whiteSpace: 'pre-line' }}>{setup.instructions}</span>
          {integration.type === 'STRIPE' && (
            <form className="c-row" onSubmit={event => void saveSecret(event)} style={{ marginTop: 6 }}>
              <input
                className="c-input c-grow"
                type="password"
                autoComplete="off"
                placeholder="Paste the endpoint's signing secret (whsec_…)"
                aria-label="Stripe signing secret"
                value={secret}
                onChange={event => setSecret(event.target.value)}
              />
              <button className="c-btn" type="submit" disabled={savingSecret || !secret.trim().startsWith('whsec_')}>Save secret</button>
            </form>
          )}
          <span className="c-muted">
            {integration.type === 'STRIPE'
              ? 'After adding the endpoint in Stripe, reveal its signing secret there and paste it here so SHAPI can verify events. Saved secrets are never shown again.'
              : `Signing secret: ${setup.webhookSecretConfigured ? 'configured (hidden)' : 'not configured'}.`}
          </span>
          {secretMessage && <span className="c-small">{secretMessage}</span>}
        </div>
      )}
      {panel === 'deliveries' && deliveries && <span className="c-strong c-small">Recent deliveries</span>}
      {panel === 'deliveries' && deliveries && (
        deliveries.length ? (
          <div className="c-card c-table-wrap">
            <table className="c-table">
              <tbody>
                {deliveries.map(delivery => (
                  <tr key={delivery.id}>
                    <td><Pill tone={statusTone(delivery.status === 'COMPLETED' ? 'PASSED' : delivery.status)}>{label(delivery.status)}</Pill></td>
                    <td className="c-small"><code>{delivery.eventType}</code></td>
                    <td className="c-muted c-small">{new Date(delivery.receivedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="c-note">None recorded yet.</p>
        )
      )}
    </div>
  );
}
