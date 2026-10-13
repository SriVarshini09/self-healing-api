import { useState } from 'react';
import { fetchShapi } from '@/lib/shapi-api';
import { Card, Empty, ErrorNote, PageHeader, Pill, errorMessage, label, statusTone, useShapi } from '../ui';
import type { GitHubStatus, Integration } from '../types';

type WebhookSetup = { webhookUrl: string; webhookSecretConfigured: boolean; instructions: string };
type Delivery = { id: string; eventType: string; providerEventId?: string | null; status: string; receivedAt: string };
type AlertStatus = { webhookConfigured: boolean; pending: number; retrying: number; delivered: number; failed: number };

export function ConnectionsPage() {
  const integrations = useShapi<{ data: Integration[] }>('integrations?pageSize=100');
  const github = useShapi<GitHubStatus>('github/status');
  const alerts = useShapi<AlertStatus>('alerts/status');
  const list = integrations.data?.data ?? [];

  return (
    <div className="c-page">
      <PageHeader
        title="Connections"
        sub="Where SHAPI receives events from, and where it sends repairs and alerts."
        actions={<button className="c-btn" onClick={() => { void integrations.reload(); void github.reload(); void alerts.reload(); }}>Refresh</button>}
      />
      <ErrorNote error={integrations.error} />
      <Card title="Integrations" sub="Providers that send webhooks to SHAPI.">
        {list.length ? (
          <div className="c-list">{list.map(item => <IntegrationRow key={item.id} integration={item} />)}</div>
        ) : (
          <Empty>{integrations.loading && !integrations.data ? 'Loading…' : 'No integrations yet.'}</Empty>
        )}
      </Card>

      <div className="c-grid-2">
        <Card title="GitHub" sub="Used to open reviewed repair pull requests.">
          <div className="c-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {github.data ? (
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

        <Card title="Alerts" sub="Signed incident notifications to your webhook.">
          <div className="c-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {alerts.data ? (
              <>
                <div><Pill tone={alerts.data.webhookConfigured ? 'ok' : 'neutral'}>{alerts.data.webhookConfigured ? 'Alert webhook set' : 'No alert webhook'}</Pill></div>
                <div className="c-row c-small">
                  <span>{alerts.data.delivered} delivered</span>
                  <span className="c-muted">·</span>
                  <span>{alerts.data.pending + alerts.data.retrying} waiting</span>
                  <span className="c-muted">·</span>
                  <span className={alerts.data.failed ? '' : 'c-muted'} style={alerts.data.failed ? { color: 'var(--c-bad)' } : undefined}>{alerts.data.failed} failed</span>
                </div>
                {!alerts.data.webhookConfigured && <p className="c-muted c-small" style={{ margin: 0 }}>Set ALERT_WEBHOOK_URL on the API to receive incidents in Slack or your pager.</p>}
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

function IntegrationRow({ integration }: { integration: Integration }) {
  const [panel, setPanel] = useState<'setup' | 'deliveries' | null>(null);
  const [setup, setSetup] = useState<WebhookSetup | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ready = integration.webhookEnabled && integration.webhookSecretConfigured;

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

  return (
    <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="c-row">
        <div className="c-grow">
          <div className="c-strong">{integration.name}</div>
          <div className="c-muted c-small">
            {label(integration.type)} · {integration._count?.invariants ?? 0} rules · {integration._count?.incidents ?? 0} incidents
          </div>
        </div>
        <Pill tone={ready ? 'ok' : 'warn'}>{ready ? 'Receiving' : 'Setup needed'}</Pill>
        <button className="c-btn" onClick={() => void open('setup')}>Setup</button>
        <button className="c-btn" onClick={() => void open('deliveries')}>Deliveries</button>
      </div>
      <ErrorNote error={error} />
      {panel === 'setup' && setup && (
        <div className="c-note" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="c-strong">Webhook endpoint</span>
          <code style={{ wordBreak: 'break-all' }}>{setup.webhookUrl}</code>
          <span style={{ whiteSpace: 'pre-line' }}>{setup.instructions}</span>
          <span className="c-muted">Signing secret: {setup.webhookSecretConfigured ? 'configured (hidden)' : 'not configured'}.</span>
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
