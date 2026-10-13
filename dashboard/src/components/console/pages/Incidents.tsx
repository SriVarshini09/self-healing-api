import { useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { Card, Empty, ErrorNote, PageHeader, Pill, cleanTitle, label, severityTone, statusTone, timeAgo, useShapi } from '../ui';
import { OPEN_STATUSES, type Incident } from '../types';

type Filter = 'open' | 'closed' | 'all';

export function IncidentsPage({ go }: { go: (route: string) => void }) {
  const [filter, setFilter] = useState<Filter>('open');
  const incidents = useShapi<{ data: Incident[] }>('incidents?pageSize=100', 15_000);
  const all = incidents.data?.data ?? [];
  const rows = all.filter(incident =>
    filter === 'all' ? true : filter === 'open' ? OPEN_STATUSES.includes(incident.status) : !OPEN_STATUSES.includes(incident.status));
  const openCount = all.filter(incident => OPEN_STATUSES.includes(incident.status)).length;

  return (
    <div className="c-page">
      <PageHeader
        title="Incidents"
        icon={<CircleAlert />}
        tint="rose"
        sub="Business outcomes that did not happen, even though the HTTP call succeeded."
        actions={<button className="c-btn" onClick={() => void incidents.reload()}>Refresh</button>}
      />
      <div role="tablist" className="c-tabs" aria-label="Incident filter">
        {([['open', `Open (${openCount})`], ['closed', 'Resolved'], ['all', 'All']] as const).map(([key, text]) => (
          <button key={key} role="tab" className="c-tab" aria-selected={filter === key} onClick={() => setFilter(key)}>{text}</button>
        ))}
      </div>
      <ErrorNote error={incidents.error} />
      <Card>
        {rows.length ? (
          <div className="c-table-wrap">
            <table className="c-table">
              <thead>
                <tr><th>Severity</th><th>Incident</th><th>Integration</th><th>Status</th><th>Detected</th></tr>
              </thead>
              <tbody>
                {rows.map(incident => (
                  <tr key={incident.id} className="is-link" onClick={() => go(`incidents/${incident.id}`)}>
                    <td><Pill tone={severityTone(incident.severity)}>{label(incident.severity)}</Pill></td>
                    <td className="c-strong">{cleanTitle(incident.invariant?.name ?? incident.title)}</td>
                    <td className="c-muted">{incident.integration?.name ?? '—'}</td>
                    <td><Pill tone={statusTone(incident.status)}>{label(incident.status)}</Pill></td>
                    <td className="c-muted c-small" title={new Date(incident.detectedAt).toLocaleString()}>{timeAgo(incident.detectedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>{incidents.loading && !incidents.data ? 'Loading…' : filter === 'open' ? 'No open incidents. Everything SHAPI watches is behaving.' : 'No incidents here.'}</Empty>
        )}
      </Card>
    </div>
  );
}
