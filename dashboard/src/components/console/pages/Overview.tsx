import { useState, type ReactNode } from 'react';
import {
  Activity, CheckCircle2, ChevronRight, CircleAlert, GitPullRequest, LayoutDashboard, RefreshCw, Timer, XCircle,
} from 'lucide-react';
import { Card, Empty, ErrorNote, Pill, cleanTitle, compact, formatDuration, humanEvent, severityTone, timeAgo, useShapi } from '../ui';
import { DailyOutcomes, SERIES, Sparkline } from '../charts';
import { OPEN_STATUSES, type Incident } from '../types';

type Stats = {
  range: { days: number };
  days: Array<{ date: string; events: number; outcomesPassed: number; outcomesFailed: number; incidentsOpened: number; incidentsResolved: number }>;
  totals: { events: number; outcomesPassed: number; outcomesFailed: number; incidentsOpened: number; incidentsResolved: number };
  previous: { events: number; outcomesPassed: number; outcomesFailed: number; incidentsOpened: number };
  openIncidents: number;
  oldestOpenIncidentAt: string | null;
  meanTimeToResolveSec: number | null;
  integrations: Array<{ id: string; name: string; type: string; events24h: number; lastEventAt: string | null }>;
  activity: Array<{ kind: 'incident_opened' | 'incident_resolved' | 'outcome_failed' | 'pr_opened'; at: string; title: string; incidentId: string | null }>;
};

const RANGES = [7, 14, 30] as const;

export function OverviewPage({ go }: { go: (route: string) => void }) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(14);
  const stats = useShapi<Stats>(`stats/overview?days=${days}`, 30_000);
  const incidents = useShapi<{ data: Incident[] }>('incidents?pageSize=100', 15_000);
  // Ignore a malformed body (e.g. an older API without this endpoint) instead of crashing the page.
  const data = stats.data && Array.isArray(stats.data.days) && stats.data.totals ? stats.data : null;
  const open = (incidents.data?.data ?? []).filter(incident => OPEN_STATUSES.includes(incident.status));

  const outcomes = data ? data.totals.outcomesPassed + data.totals.outcomesFailed : 0;
  const health = data && outcomes ? (data.totals.outcomesPassed / outcomes) * 100 : null;
  const previousOutcomes = data ? data.previous.outcomesPassed + data.previous.outcomesFailed : 0;
  const previousHealth = data && previousOutcomes ? (data.previous.outcomesPassed / previousOutcomes) * 100 : null;
  const series = (field: keyof Stats['days'][number]) => (data?.days ?? []).map(day => Number(day[field]));

  return (
    <div className="c-page">
      <header className="c-page-head">
        <div className="c-title-row">
          <span className="c-page-icon is-blue"><LayoutDashboard /></span>
          <div>
            <h1 className="c-page-title">Overview</h1>
            <p className="c-page-sub">Are paying customers getting what they paid for?</p>
          </div>
        </div>
        <div className="c-row">
          <div role="tablist" className="c-tabs" aria-label="Time range">
            {RANGES.map(range => (
              <button key={range} role="tab" className="c-tab" aria-selected={days === range} onClick={() => setDays(range)}>{range}d</button>
            ))}
          </div>
          <button className="c-btn" aria-label="Refresh" onClick={() => { void stats.reload(); void incidents.reload(); }}><RefreshCw /></button>
        </div>
      </header>
      <ErrorNote error={stats.error ?? incidents.error} />

      {incidents.data && (open.length ? (
        <div className="c-banner is-bad">
          <CircleAlert />
          <span className="c-grow"><strong>{open.length} incident{open.length === 1 ? '' : 's'} need{open.length === 1 ? 's' : ''} review.</strong> Some customers may have paid without getting access.</span>
          <button className="c-btn" onClick={() => go('incidents')}>Review</button>
        </div>
      ) : (
        <div className="c-banner is-ok"><CheckCircle2 /><span><strong>All clear.</strong> Every customer outcome SHAPI checked looks right.</span></div>
      ))}

      <section className="c-card c-hero">
        <div className="c-hero-figure">
          <span className="c-stat-label">Outcome health · last {days} days</span>
          <div className="c-hero-value">{health === null ? '—' : `${health >= 99.95 || health === 0 ? health.toFixed(0) : health.toFixed(1)}%`}</div>
          {health !== null && previousHealth !== null && (
            <Delta value={health - previousHealth} suffix=" pts" goodWhenUp label={`vs previous ${days} days`} />
          )}
          <p className="c-hero-note">
            {data
              ? outcomes
                ? <><strong>{data.totals.outcomesPassed.toLocaleString()}</strong> of {outcomes.toLocaleString()} customer outcomes verified · <strong>{data.totals.outcomesFailed.toLocaleString()}</strong> failed</>
                : 'No customer outcomes checked yet. Add an outcome check to start.'
              : 'Loading…'}
          </p>
          {health !== null && (
            <div className="c-meter" aria-hidden>
              <span style={{ width: `${health}%`, background: SERIES.verified }} />
              <span style={{ width: `${100 - health}%`, background: SERIES.failed }} />
            </div>
          )}
        </div>
        <div className="c-hero-chart">
          <span className="c-card-title">Customer outcomes per day</span>
          {data ? <DailyOutcomes data={data.days.map(day => ({ date: day.date, verified: day.outcomesPassed, failed: day.outcomesFailed }))} /> : <Empty>Loading…</Empty>}
        </div>
      </section>

      <div className="c-grid-4">
        <StatTile
          icon={<Activity />} tone="info" label="Events received" value={data ? compact(data.totals.events) : '—'}
          delta={data ? percentDelta(data.totals.events, data.previous.events) : null} goodWhenUp
          trend={series('events')}
        />
        <StatTile
          icon={<CheckCircle2 />} tone="ok" label="Outcomes verified" value={data ? compact(data.totals.outcomesPassed) : '—'}
          delta={data ? percentDelta(data.totals.outcomesPassed, data.previous.outcomesPassed) : null} goodWhenUp
          trend={series('outcomesPassed')}
        />
        <StatTile
          icon={<CircleAlert />} tone="bad" label="Open incidents" value={data ? String(data.openIncidents) : '—'}
          note={data?.oldestOpenIncidentAt ? `oldest opened ${timeAgo(data.oldestOpenIncidentAt)}` : 'none open'}
          trend={series('incidentsOpened')}
        />
        <StatTile
          icon={<Timer />} tone="warn" label="Time to resolve" value={data ? formatDuration(data.meanTimeToResolveSec) : '—'}
          note={data ? `${data.totals.incidentsResolved} resolved in ${days} days` : undefined}
        />
      </div>

      <div className="c-grid-2">
        <Card title="Needs attention" tint="rose" actions={<button className="c-btn is-quiet" onClick={() => go('incidents')}>All incidents</button>}>
          {open.length ? (
            <div className="c-list">
              {open.slice(0, 6).map(incident => (
                <div key={incident.id} className="c-list-row is-link" onClick={() => go(`incidents/${incident.id}`)}>
                  <Pill tone={severityTone(incident.severity)}>{incident.severity.toLowerCase()}</Pill>
                  <div className="c-grow">
                    <div className="c-truncate c-strong">{cleanTitle(incident.invariant?.name ?? incident.title)}</div>
                    <div className="c-muted c-small">{incident.integration?.name ?? 'Integration'} · opened {timeAgo(incident.detectedAt)}</div>
                  </div>
                  <ChevronRight className="c-chevron" />
                </div>
              ))}
            </div>
          ) : (
            <Empty>{incidents.data ? 'Nothing needs attention.' : 'Loading…'}</Empty>
          )}
        </Card>

        <Card title="Recent activity" tint="lavender">
          {data?.activity.length ? (
            <ul className="c-feed">
              {data.activity.slice(0, 7).map((item, index) => (
                <li
                  key={`${item.at}-${index}`}
                  className={item.incidentId ? 'is-link' : undefined}
                  onClick={item.incidentId ? () => go(`incidents/${item.incidentId}`) : undefined}
                >
                  <FeedIcon kind={item.kind} />
                  <div className="c-grow">
                    <div className="c-truncate">{feedText(item)}</div>
                    <div className="c-muted c-small">{timeAgo(item.at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>{data ? 'No activity yet.' : 'Loading…'}</Empty>
          )}
        </Card>
      </div>

      <Card title="Integration health" tint="teal" sub="Events received in the last 24 hours" actions={<button className="c-btn is-quiet" onClick={() => go('connections')}>Connections</button>}>
        {data?.integrations.length ? (
          <div className="c-list">
            {data.integrations.map(integration => {
              const fresh = integration.lastEventAt && Date.now() - new Date(integration.lastEventAt).getTime() < 24 * 3600 * 1000;
              return (
                <div key={integration.id} className="c-list-row">
                  <span className={`c-dot ${fresh ? 'is-ok' : integration.lastEventAt ? 'is-warn' : ''}`} />
                  <span className="c-grow c-strong">{integration.name}</span>
                  <span className="c-muted c-small">{integration.lastEventAt ? `last event ${timeAgo(integration.lastEventAt)}` : 'no events yet'}</span>
                  <Pill tone={fresh ? 'ok' : 'neutral'}>{integration.events24h.toLocaleString()} today</Pill>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty>{data ? 'No integrations yet.' : 'Loading…'}</Empty>
        )}
      </Card>
    </div>
  );
}

const TILE_TINT = { info: 'blue', ok: 'mint', bad: 'rose', warn: 'peach' } as const;
const TILE_LINE = { info: '#5b7be0', ok: '#3f9a6b', bad: '#e0694f', warn: '#d9a21b' } as const;

function percentDelta(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

function Delta({ value, suffix = '%', goodWhenUp, label }: { value: number; suffix?: string; goodWhenUp: boolean; label?: string }) {
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  const good = rounded === 0 ? null : (rounded > 0) === goodWhenUp;
  return (
    <span className={`c-delta ${good === null ? '' : good ? 'is-good' : 'is-bad'}`}>
      {rounded > 0 ? '▲' : rounded < 0 ? '▼' : '■'} {Math.abs(rounded).toFixed(Math.abs(rounded) < 10 ? 1 : 0)}{suffix}
      {label && <span className="c-muted"> {label}</span>}
    </span>
  );
}

function StatTile({
  icon, tone, label, value, delta, goodWhenUp = true, note, trend,
}: {
  icon: ReactNode; tone: 'ok' | 'bad' | 'warn' | 'info'; label: string; value: string;
  delta?: number | null; goodWhenUp?: boolean; note?: string; trend?: number[];
}) {
  return (
    <div className={`c-card c-stat is-${TILE_TINT[tone]}`}>
      <div className="c-row">
        <span className="c-icon-tile">{icon}</span>
        <span className="c-stat-label">{label}</span>
      </div>
      <div className="c-stat-value">{value}</div>
      <div className="c-stat-note">
        {delta !== undefined && delta !== null ? <Delta value={delta} goodWhenUp={goodWhenUp} label="vs previous" /> : note ?? ' '}
      </div>
      {trend && trend.length > 1 && <Sparkline values={trend} label={`${label} per day`} color={TILE_LINE[tone]} />}
    </div>
  );
}

function FeedIcon({ kind }: { kind: Stats['activity'][number]['kind'] }) {
  if (kind === 'incident_opened') return <span className="c-icon-tile is-bad"><CircleAlert /></span>;
  if (kind === 'incident_resolved') return <span className="c-icon-tile is-ok"><CheckCircle2 /></span>;
  if (kind === 'pr_opened') return <span className="c-icon-tile is-info"><GitPullRequest /></span>;
  return <span className="c-icon-tile is-warn"><XCircle /></span>;
}

function feedText(item: Stats['activity'][number]): string {
  const title = item.kind === 'outcome_failed'
    ? item.title.replace(/^([a-z_]+\.[a-z_.]+)/, match => humanEvent(match))
    : cleanTitle(item.title);
  if (item.kind === 'incident_opened') return `Incident opened: ${title}`;
  if (item.kind === 'incident_resolved') return `Incident resolved: ${title}`;
  if (item.kind === 'pr_opened') return `Repair PR opened: ${title}`;
  return `Outcome failed: ${title}`;
}
