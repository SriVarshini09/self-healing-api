import { Card, Empty, ErrorNote, PageHeader, Pill, severityTone, timeAgo, useShapi } from '../ui';
import { OPEN_STATUSES, type Incident, type Integration, type OutcomeCheck } from '../types';

export function OverviewPage({ go }: { go: (route: string) => void }) {
  const incidents = useShapi<{ data: Incident[] }>('incidents?pageSize=100', 15_000);
  const checks = useShapi<{ data: OutcomeCheck[] }>('outcome-checks', 30_000);
  const integrations = useShapi<{ data: Integration[] }>('integrations?pageSize=100');
  const summary = useShapi<{ totalInvariants: number; monitoredIntegrations: number; activeAlerts: number }>('drift/summary', 30_000);

  const open = (incidents.data?.data ?? []).filter(incident => OPEN_STATUSES.includes(incident.status));
  const checkList = checks.data?.data ?? [];
  const passed24h = checkList.reduce((sum, check) => sum + (check.runsLast24h?.PASSED ?? 0), 0);
  const failed24h = checkList.reduce((sum, check) => sum + (check.runsLast24h?.FAILED ?? 0), 0);
  const loaded = Boolean(incidents.data);

  return (
    <div className="c-page">
      <PageHeader
        title="Overview"
        sub="What SHAPI is watching right now."
        actions={<button className="c-btn" onClick={() => { void incidents.reload(); void checks.reload(); void summary.reload(); }}>Refresh</button>}
      />
      <ErrorNote error={incidents.error} />

      {loaded && (open.length ? (
        <div className="c-banner is-bad">
          <span className="c-grow"><strong>{open.length} incident{open.length === 1 ? '' : 's'} need{open.length === 1 ? 's' : ''} review.</strong> Customers may have paid without getting what they paid for.</span>
          <button className="c-btn" onClick={() => go('incidents')}>Review</button>
        </div>
      ) : (
        <div className="c-banner is-ok"><strong>All clear.</strong> No open incidents.</div>
      ))}

      <div className="c-grid-4">
        <Stat label="Open incidents" value={loaded ? open.length : '—'} note="need review" />
        <Stat label="Outcomes verified (24h)" value={checks.data ? passed24h : '—'} note={checks.data ? `${failed24h} failed` : ''} />
        <Stat label="Rules watching" value={summary.data?.totalInvariants ?? '—'} note="invariants" />
        <Stat label="Connections" value={integrations.data?.data.length ?? '—'} note="integrations" />
      </div>

      <div className="c-grid-2">
        <Card title="Needs attention" actions={<button className="c-btn is-quiet" onClick={() => go('incidents')}>All incidents</button>}>
          {open.length ? (
            <div className="c-list">
              {open.slice(0, 6).map(incident => (
                <div key={incident.id} className="c-list-row is-link" onClick={() => go(`incidents/${incident.id}`)}>
                  <Pill tone={severityTone(incident.severity)}>{incident.severity.toLowerCase()}</Pill>
                  <span className="c-grow c-truncate">{incident.title}</span>
                  <span className="c-muted c-small">{timeAgo(incident.detectedAt)}</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty>{loaded ? 'Nothing needs attention.' : 'Loading…'}</Empty>
          )}
        </Card>

        <Card title="Outcome checks" sub="Last 24 hours" actions={<button className="c-btn is-quiet" onClick={() => go('checks')}>Manage</button>}>
          {checkList.length ? (
            <div className="c-list">
              {checkList.slice(0, 6).map(check => (
                <div key={check.id} className="c-list-row is-link" onClick={() => go('checks')}>
                  <span className="c-grow c-truncate">{check.name}</span>
                  <Pill tone="ok">{check.runsLast24h?.PASSED ?? 0} ok</Pill>
                  <Pill tone={check.runsLast24h?.FAILED ? 'bad' : 'neutral'}>{check.runsLast24h?.FAILED ?? 0} failed</Pill>
                </div>
              ))}
            </div>
          ) : (
            <Empty>
              {checks.data ? <>No outcome checks yet. <a onClick={() => go('checks')} href="#/checks">Create one</a>.</> : 'Loading…'}
            </Empty>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return (
    <div className="c-card c-stat">
      <div className="c-stat-label">{label}</div>
      <div className="c-stat-value">{value}</div>
      {note && <div className="c-stat-note">{note}</div>}
    </div>
  );
}
