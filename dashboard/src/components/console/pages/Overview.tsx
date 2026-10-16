import { useRef, useState, type ReactNode } from 'react';
import {
  Activity, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, ListChecks, ShieldCheck, Timer, TrendingDown, TrendingUp,
} from 'lucide-react';
import { Empty, ErrorNote, Pill, cleanTitle, compact, formatDuration, label, rowLink, timeAgo, useShapi, type Tone } from '../ui';
import { DailyOutcomes } from '../charts';
import { OPEN_STATUSES, type Incident, type OutcomeCheck } from '../types';

type Stats = {
  days: Array<{ date: string; events: number; outcomesPassed: number; outcomesFailed: number }>;
  totals: { events: number; outcomesPassed: number; outcomesFailed: number; incidentsResolved: number };
  previous: { events: number; outcomesPassed: number; outcomesFailed: number; incidentsOpened: number };
  openIncidents: number;
  oldestOpenIncidentAt: string | null;
  meanTimeToResolveSec: number | null;
  integrations: Array<{ id: string; name: string; type: string; events24h: number; lastEventAt: string | null }>;
};

const RANGES = [7, 14, 30] as const;

const LOGO: Record<string, { bg: string; fg: string; text: string }> = {
  STRIPE: { bg: '#efeeff', fg: '#5b4fe0', text: 'S' },
  GITHUB: { bg: '#f1f1f1', fg: '#111111', text: 'G' },
  SENDGRID: { bg: '#e8f4fd', fg: '#1a82e2', text: 'SG' },
  TWILIO: { bg: '#fdecee', fg: '#e22b3e', text: 'T' },
};

function Logo({ type }: { type?: string }) {
  const logo = LOGO[type ?? ''] ?? { bg: '#f2f2f1', fg: '#4d4d4d', text: (type ?? '?').slice(0, 1) };
  return <span className="c-match-logo" style={{ background: logo.bg, color: logo.fg }}>{logo.text}</span>;
}

function severityLabel(severity: string): { text: string; tone: Tone } {
  if (severity === 'CRITICAL' || severity === 'HIGH') return { text: 'High', tone: 'bad' };
  if (severity === 'MEDIUM') return { text: 'Medium', tone: 'warn' };
  return { text: 'Normal', tone: 'ok' };
}

export function OverviewPage({ go }: { go: (route: string) => void }) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(14);
  const [queue, setQueue] = useState<'all' | 'open' | 'closed'>('all');
  const carousel = useRef<HTMLDivElement>(null);
  const stats = useShapi<Stats>(`stats/overview?days=${days}`, 30_000);
  const incidents = useShapi<{ data: Incident[] }>('incidents?pageSize=100', 15_000);
  const checks = useShapi<{ data: OutcomeCheck[] }>('outcome-checks', 30_000);

  // Ignore a malformed body (e.g. an older API without this endpoint) instead of crashing the page.
  const data = stats.data && Array.isArray(stats.data.days) && stats.data.totals ? stats.data : null;
  const allIncidents = incidents.data?.data ?? [];
  const open = allIncidents.filter(incident => OPEN_STATUSES.includes(incident.status));
  const checkList = checks.data?.data ?? [];

  const outcomes = data ? data.totals.outcomesPassed + data.totals.outcomesFailed : 0;
  const health = data && outcomes ? (data.totals.outcomesPassed / outcomes) * 100 : null;
  const tasks = allIncidents
    .filter(incident => queue === 'all' || (queue === 'open') === OPEN_STATUSES.includes(incident.status))
    .sort((a, b) => Number(OPEN_STATUSES.includes(b.status)) - Number(OPEN_STATUSES.includes(a.status)))
    .slice(0, 6);

  const scrollCarousel = (direction: 1 | -1) => carousel.current?.scrollBy({ left: direction * 376, behavior: 'smooth' });

  return (
    <div className="c-page">
      <header className="c-page-head">
        <div>
          <h1 className="c-page-title">Overview</h1>
          <p className="c-page-sub">Are paying customers getting what they paid for?</p>
        </div>
      </header>
      <ErrorNote error={stats.error ?? incidents.error} />
      {data && checks.data && (
        <GetStarted
          go={go}
          hasStripe={data.integrations.some(integration => integration.type === 'STRIPE')}
          hasCheck={checkList.length > 0}
          hasVerified={data.totals.outcomesPassed > 0 || checkList.some(check => (check.runsLast24h?.PASSED ?? 0) > 0)}
        />
      )}

      <section className="c-panel" aria-label="Outcome health">
        <div className="c-panel-top">
          <div>
            <div className="c-panel-label">Outcome health</div>
            <div className="c-ring-row">
              <Ring value={health} />
              <div>
                <div className="c-big">{health === null ? '—' : <>{health.toFixed(health >= 99.95 || health === 0 ? 0 : 1)}<small>%</small></>}</div>
                <div className="c-muted">
                  {data
                    ? outcomes
                      ? `${data.totals.outcomesPassed.toLocaleString()} of ${outcomes.toLocaleString()} customer outcomes verified · last ${days} days`
                      : `No customer outcomes checked in the last ${days} days`
                    : 'Loading…'}
                </div>
              </div>
            </div>
          </div>
          <div className="c-row">
            <div role="tablist" className="c-tabs" aria-label="Time range">
              {RANGES.map(range => (
                <button key={range} role="tab" className="c-tab" aria-selected={days === range} onClick={() => setDays(range)}>{range}d</button>
              ))}
            </div>
            <button className="c-btn is-primary" onClick={() => go('checks')}>Add outcome check</button>
            <button className="c-btn" onClick={() => go('incidents')}>View incidents</button>
          </div>
        </div>
        <div className="c-grid-4">
          <Mini icon={<Activity />} label="Events received" value={data ? compact(data.totals.events) : '—'}
            delta={data ? percentDelta(data.totals.events, data.previous.events) : null} goodWhenUp />
          <Mini icon={<CheckCircle2 />} label="Outcomes verified" value={data ? compact(data.totals.outcomesPassed) : '—'}
            delta={data ? percentDelta(data.totals.outcomesPassed, data.previous.outcomesPassed) : null} goodWhenUp />
          <Mini icon={<CircleAlert />} label="Open incidents" value={data ? String(data.openIncidents) : '—'}
            note={data?.oldestOpenIncidentAt ? `oldest ${timeAgo(data.oldestOpenIncidentAt)}` : 'none open'} />
          <Mini icon={<Timer />} label="Average time to resolve" value={data ? formatDuration(data.meanTimeToResolveSec) : '—'}
            note={data ? `${data.totals.incidentsResolved} resolved` : undefined} />
        </div>
      </section>

      <section className="c-section">
        <div className="c-section-head">
          <h2 className="c-section-title">Needs attention <span className="c-count">{open.length}</span></h2>
          {open.length > 1 && (
            <div className="c-arrows">
              <button className="c-arrow" aria-label="Previous" onClick={() => scrollCarousel(-1)}><ChevronLeft /></button>
              <button className="c-arrow" aria-label="Next" onClick={() => scrollCarousel(1)}><ChevronRight /></button>
            </div>
          )}
        </div>
        {open.length ? (
          <div className="c-carousel" ref={carousel}>
            {open.map(incident => {
              const severity = severityLabel(incident.severity);
              return (
                <article key={incident.id} className="c-match" onClick={() => go(`incidents/${incident.id}`)}>
                  <div className="c-match-top">
                    <Logo type={incident.integration?.type} />
                    <div className="c-grow">
                      <div className="c-match-title c-truncate">{cleanTitle(incident.invariant?.name ?? incident.title)}</div>
                      <div className="c-match-sub">{incident.integration?.name ?? 'Integration'} · {label(incident.status)}</div>
                    </div>
                    <Pill tone={severity.tone}>{severity.text}</Pill>
                    {incident.status === 'DETECTED' && <Pill tone="info">New</Pill>}
                    <ChevronRight className="c-chevron" />
                  </div>
                  <p className="c-match-desc">{incident.rootCause ?? incident.description ?? 'Not diagnosed yet.'}</p>
                  <div className="c-match-foot">
                    <div className="c-match-foot-label">Incident overview</div>
                    <div className="c-row">
                      <span className="c-chip">Detected {timeAgo(incident.detectedAt)}</span>
                      <span className="c-chip">{incident.rootCause ? 'Diagnosed' : 'Needs diagnosis'}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="c-card"><Empty>{!incidents.data ? 'Loading…' : checkList.length ? 'Nothing needs attention. Every customer outcome SHAPI checked looks right.' : 'Nothing to review yet. Incidents appear here once an outcome check is running.'}</Empty></div>
        )}
      </section>

      <div className="c-split">
        <section className="c-section">
          <div className="c-section-head">
            <h2 className="c-section-title">Outcome checks <span className="c-count">{checkList.length}</span></h2>
            <button className="c-btn is-quiet" onClick={() => go('checks')}>Manage</button>
          </div>
          <div className="c-card">
            {checkList.length ? (
              <div className="c-table-wrap">
                <table className="c-table">
                  <thead><tr><th>Check</th><th>After event</th><th>Last 24h</th><th>Status</th></tr></thead>
                  <tbody>
                    {checkList.slice(0, 6).map(check => {
                      const failed = check.runsLast24h?.FAILED ?? 0;
                      return (
                        <tr key={check.id} {...rowLink(() => go('checks'))}>
                          <td><div className="c-cell-entity"><span className="c-match-logo" style={{ background: '#e6f5ec', color: '#1f7a4d' }}><ListChecks size={13} /></span><span className="c-truncate">{check.name}</span></div></td>
                          <td className="c-muted c-small"><code>{check.triggerEventType}</code></td>
                          <td><span className="c-row"><Pill tone="ok">{check.runsLast24h?.PASSED ?? 0} ok</Pill><Pill tone={failed ? 'bad' : 'neutral'}>{failed} failed</Pill></span></td>
                          <td><Pill tone={!check.enabled ? 'neutral' : failed ? 'bad' : 'ok'}>{!check.enabled ? 'Paused' : failed ? 'Failing' : 'Active'}</Pill></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>{checks.data ? <>No outcome checks yet. <a href="#/checks">Add one</a> to verify every paying customer.</> : 'Loading…'}</Empty>
            )}
          </div>
        </section>

        <section className="c-card c-card-body" aria-label="Review queue" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 className="c-card-title">Review queue</h2>
          <div className="c-seg" role="tablist" aria-label="Review queue filter">
            {(['all', 'open', 'closed'] as const).map(key => (
              <button key={key} role="tab" aria-selected={queue === key} onClick={() => setQueue(key)}>{label(key)}</button>
            ))}
          </div>
          <div className="c-tasks">
            {tasks.length ? tasks.map(incident => {
              const done = !OPEN_STATUSES.includes(incident.status);
              const severity = severityLabel(incident.severity);
              return (
                <div key={incident.id} className={`c-task${done ? ' is-done' : ''}`} onClick={() => go(`incidents/${incident.id}`)}>
                  <span className={`c-check${done ? ' is-done' : ''}`}>{done && <Check />}</span>
                  <span className="c-task-text c-grow c-truncate">Review: {cleanTitle(incident.invariant?.name ?? incident.title)}</span>
                  <Pill tone={done ? 'neutral' : severity.tone}>{done ? label(incident.status) : severity.text}</Pill>
                </div>
              );
            }) : <p className="c-empty" style={{ padding: 12 }}>{incidents.data ? 'Nothing here.' : 'Loading…'}</p>}
          </div>
        </section>
      </div>

      <div className="c-split">
        <section className="c-card c-card-body">
          <div className="c-section-head" style={{ marginBottom: 8 }}>
            <h2 className="c-card-title">Customer outcomes per day</h2>
          </div>
          {data ? <DailyOutcomes data={data.days.map(day => ({ date: day.date, verified: day.outcomesPassed, failed: day.outcomesFailed }))} /> : <Empty>Loading…</Empty>}
        </section>
        <section className="c-card">
          <div className="c-card-head">
            <div>
              <h2 className="c-card-title">Integration health</h2>
              <p className="c-card-sub">Events received in the last 24 hours</p>
            </div>
          </div>
          {data?.integrations.length ? (
            <div className="c-list">
              {data.integrations.map(integration => {
                const fresh = integration.lastEventAt && Date.now() - new Date(integration.lastEventAt).getTime() < 24 * 3600 * 1000;
                return (
                  <div key={integration.id} className="c-list-row">
                    <Logo type={integration.type} />
                    <div className="c-grow">
                      <div className="c-strong c-truncate">{integration.name}</div>
                      <div className="c-muted c-small">{integration.lastEventAt ? `last event ${timeAgo(integration.lastEventAt)}` : 'no events yet'}</div>
                    </div>
                    <Pill tone={fresh ? 'ok' : 'neutral'}>{integration.events24h.toLocaleString()} today</Pill>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty>{data ? 'No integrations yet.' : 'Loading…'}</Empty>
          )}
        </section>
      </div>
    </div>
  );
}

function GetStarted({ go, hasStripe, hasCheck, hasVerified }: { go: (route: string) => void; hasStripe: boolean; hasCheck: boolean; hasVerified: boolean }) {
  const steps = [
    { done: true, title: 'Create your workspace', detail: 'Done.', action: null },
    { done: hasStripe, title: 'Connect Stripe', detail: 'Add a Stripe connection so SHAPI knows where payments come from.', action: { label: 'Add connection', route: 'connections' } },
    { done: hasCheck, title: 'Add an outcome check', detail: 'Write the query that proves a paying customer got access.', action: { label: 'New check', route: 'checks' } },
    { done: hasVerified, title: 'Verify your first customer outcome', detail: 'Test the check with a real Stripe event, or let the next payment come in.', action: { label: 'Test a check', route: 'checks' } },
  ];
  const doneCount = steps.filter(step => step.done).length;
  if (doneCount === steps.length) return null;
  return (
    <section className="c-card" aria-label="Get started">
      <div className="c-card-head">
        <div>
          <h2 className="c-card-title">Get started</h2>
          <p className="c-card-sub">{doneCount} of {steps.length} done · about 15 minutes · <a href="https://github.com/SriVarshini09/self-healing-api/blob/master/docs/QUICK-SETUP.md" target="_blank" rel="noreferrer">setup guide</a></p>
        </div>
        <div className="c-progress" style={{ width: 160, margin: 0 }}><span style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>
      </div>
      <div className="c-list">
        {steps.map(step => (
          <div key={step.title} className="c-list-row">
            <span className={`c-check${step.done ? ' is-done' : ''}`}>{step.done && <Check />}</span>
            <div className="c-grow">
              <div className={step.done ? 'c-muted' : 'c-strong'}>{step.title}</div>
              {!step.done && <div className="c-muted c-small">{step.detail}</div>}
            </div>
            {!step.done && step.action && <button className="c-btn" onClick={() => go(step.action!.route)}>{step.action.label}</button>}
          </div>
        ))}
      </div>
    </section>
  );
}

function Ring({ value }: { value: number | null }) {
  const size = 88;
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = value === null ? 0 : (value / 100) * circumference;
  return (
    <div className="c-ring" role="img" aria-label={value === null ? 'No outcome data' : `${value.toFixed(1)}% of outcomes verified`}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e4e4e2" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#3b7dd8" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
        />
      </svg>
      <span className="c-ring-mark"><ShieldCheck /></span>
    </div>
  );
}

function percentDelta(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

function Mini({
  icon, label: text, value, delta, goodWhenUp = true, note,
}: { icon: ReactNode; label: string; value: string; delta?: number | null; goodWhenUp?: boolean; note?: string }) {
  const rounded = delta === undefined || delta === null ? null : Math.abs(delta) < 0.05 ? 0 : delta;
  const good = rounded === null || rounded === 0 ? null : (rounded > 0) === goodWhenUp;
  return (
    <div className="c-mini">
      <div className="c-mini-label"><span className="c-mini-icon">{icon}</span>{text}</div>
      <div className="c-mini-value">
        {value}
        {rounded !== null ? (
          <span className={`c-delta ${good === null ? '' : good ? 'is-good' : 'is-bad'}`}>
            {rounded >= 0 ? <TrendingUp /> : <TrendingDown />}{rounded > 0 ? '+' : ''}{rounded.toFixed(Math.abs(rounded) < 10 ? 1 : 0)}%
            <span className="c-muted">vs previous</span>
          </span>
        ) : note ? <small>{note}</small> : null}
      </div>
    </div>
  );
}
