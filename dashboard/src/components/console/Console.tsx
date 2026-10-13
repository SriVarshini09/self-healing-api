// SHAPI console: a quiet, page-per-task dashboard.
// Routes live in the URL hash (#/incidents/<id>) so the static build needs no server routing.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  BadgeCheck, Bell, BookOpen, Cable, CircleAlert, CircleHelp, Home, ListChecks, LogOut, ScrollText, Search, ShieldCheck,
} from 'lucide-react';
import { SHAPI_API, SHAPI_KEY } from '@/lib/shapi-api';
import { OPEN_STATUSES, type Incident, type OutcomeCheck } from './types';
import { cleanTitle, useShapi } from './ui';
import { OverviewPage } from './pages/Overview';
import { IncidentsPage } from './pages/Incidents';
import { IncidentDetailPage } from './pages/IncidentDetail';
import { OutcomeChecksPage } from './pages/OutcomeChecks';
import { RulesPage } from './pages/Rules';
import { ConnectionsPage } from './pages/Connections';
import './console.css';

const DOCS_URL = 'https://github.com/SriVarshini09/self-healing-api#readme';

function readRoute(): string {
  if (typeof window === 'undefined') return 'overview';
  return window.location.hash.replace(/^#\/?/, '') || 'overview';
}

function useRoute(): [string, (route: string) => void] {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const onChange = () => setRoute(readRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const go = (next: string) => {
    window.location.hash = `/${next}`;
    window.scrollTo({ top: 0 });
  };
  return [route, go];
}

type NavItem = { route: string; label: string; icon: ReactNode };
const NAV_SECTIONS: Array<{ label?: string; items: NavItem[] }> = [
  { items: [{ route: 'overview', label: 'Overview', icon: <Home /> }] },
  {
    label: 'Monitor',
    items: [
      { route: 'incidents', label: 'Incidents', icon: <CircleAlert /> },
      { route: 'checks', label: 'Outcome checks', icon: <ListChecks /> },
      { route: 'rules', label: 'Rules', icon: <ScrollText /> },
    ],
  },
  { label: 'Setup', items: [{ route: 'connections', label: 'Connections', icon: <Cable /> }] },
];

type ShellStats = { workspace?: { name: string }; totals?: { outcomesPassed: number; outcomesFailed: number } };

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]!.toUpperCase()).join('') || 'S';
}

function Shell() {
  const [route, go] = useRoute();
  const incidents = useShapi<{ data: Incident[] }>('incidents?pageSize=100', 30_000);
  const checks = useShapi<{ data: OutcomeCheck[] }>('outcome-checks', 60_000);
  const stats = useShapi<ShellStats>('stats/overview?days=14', 60_000);
  const openCount = (incidents.data?.data ?? []).filter(incident => OPEN_STATUSES.includes(incident.status)).length;
  const section = route.split('/')[0];
  const workspace = stats.data?.workspace?.name ?? 'Workspace';
  const totals = stats.data?.totals;
  const outcomes = totals ? totals.outcomesPassed + totals.outcomesFailed : 0;
  const health = totals && outcomes ? (totals.outcomesPassed / outcomes) * 100 : null;

  const signOut = async () => {
    await fetch(`${SHAPI_API}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => undefined);
    window.location.reload();
  };

  let page: ReactNode;
  if (section === 'incidents' && route.split('/')[1]) page = <IncidentDetailPage key={route} id={route.split('/')[1]} go={go} />;
  else if (section === 'incidents') page = <IncidentsPage go={go} />;
  else if (section === 'checks') page = <OutcomeChecksPage />;
  else if (section === 'rules') page = <RulesPage />;
  else if (section === 'connections') page = <ConnectionsPage />;
  else page = <OverviewPage go={go} />;

  return (
    <div className="c-app">
      <aside className="c-sidebar">
        <div className="c-brand">
          <span className="c-brand-mark"><ShieldCheck /></span>
          <span className="c-brand-name">SHAPI</span>
        </div>
        <div className="c-account">
          <span className="c-avatar">{initials(workspace)}</span>
          <div className="c-grow">
            <div className="c-account-name"><span className="c-truncate">{workspace}</span><BadgeCheck /></div>
            <div className="c-account-sub">Outcome monitoring</div>
          </div>
        </div>
        <nav aria-label="Main" className="c-nav">
          {NAV_SECTIONS.map((group, index) => (
            <div key={group.label ?? index} className="c-nav">
              {group.label && <div className="c-nav-section">{group.label}</div>}
              {group.items.map(item => (
                <a
                  key={item.route}
                  href={`#/${item.route}`}
                  className="c-nav-link"
                  aria-current={section === item.route || (section === '' && item.route === 'overview') ? 'page' : undefined}
                >
                  {item.icon}
                  {item.label}
                  {item.route === 'incidents' && openCount > 0 && <span className="c-nav-count">{openCount}</span>}
                </a>
              ))}
            </div>
          ))}
          <div className="c-nav-section">Other</div>
          <a className="c-nav-link" href={DOCS_URL} target="_blank" rel="noreferrer"><BookOpen />Documentation</a>
          {!SHAPI_KEY && <button className="c-nav-link" onClick={() => void signOut()}><LogOut />Sign out</button>}
        </nav>
        <div className="c-side-card">
          <div className="c-side-card-row">
            <span className="c-strong">Outcome health</span>
            <span className="c-muted">{health === null ? 'no data' : `${health.toFixed(0)}%`}</span>
          </div>
          <div className="c-progress"><span style={{ width: `${health ?? 0}%` }} /></div>
          <div className="c-side-card-row">
            <span className="c-muted">{incidents.error ? 'API unreachable' : 'Last 14 days'}</span>
            <a href="#/checks">Add check</a>
          </div>
        </div>
      </aside>
      <div className="c-main">
        <header className="c-topbar">
          <SearchBox incidents={incidents.data?.data ?? []} checks={checks.data?.data ?? []} go={go} />
          <div className="c-grow" />
          <a className="c-icon-btn" href={DOCS_URL} target="_blank" rel="noreferrer" aria-label="Help and documentation"><CircleHelp /></a>
          <a className="c-icon-btn" href="#/incidents" aria-label={`${openCount} open incidents`}>
            <Bell />
            {openCount > 0 && <span className="c-badge">{openCount}</span>}
          </a>
        </header>
        <main className="c-content">{page}</main>
      </div>
    </div>
  );
}

type SearchResult = { key: string; label: string; kind: string; route: string };

function SearchBox({ incidents, checks, go }: { incidents: Incident[]; checks: OutcomeCheck[]; go: (route: string) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const blurTimer = useRef<number | undefined>(undefined);

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const pages: SearchResult[] = [
      { key: 'p-overview', label: 'Overview', kind: 'Page', route: 'overview' },
      { key: 'p-incidents', label: 'Incidents', kind: 'Page', route: 'incidents' },
      { key: 'p-checks', label: 'Outcome checks', kind: 'Page', route: 'checks' },
      { key: 'p-rules', label: 'Rules', kind: 'Page', route: 'rules' },
      { key: 'p-connections', label: 'Connections', kind: 'Page', route: 'connections' },
    ];
    const all: SearchResult[] = [
      ...incidents.map(incident => ({
        key: `i-${incident.id}`, label: cleanTitle(incident.invariant?.name ?? incident.title), kind: 'Incident', route: `incidents/${incident.id}`,
      })),
      ...checks.map(check => ({ key: `c-${check.id}`, label: check.name, kind: 'Outcome check', route: 'checks' })),
      ...pages,
    ];
    return all.filter(item => item.label.toLowerCase().includes(q)).slice(0, 7);
  }, [query, incidents, checks]);

  const choose = (item: SearchResult | undefined) => {
    if (!item) return;
    go(item.route);
    setQuery('');
    setOpen(false);
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(index + 1, results.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(index - 1, 0)); }
    else if (event.key === 'Enter') { event.preventDefault(); choose(results[active]); }
    else if (event.key === 'Escape') { setOpen(false); }
  };

  return (
    <div className="c-search">
      <input
        type="search"
        placeholder="Search incidents, checks, pages…"
        aria-label="Search"
        value={query}
        onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { blurTimer.current = window.setTimeout(() => setOpen(false), 150); }}
        onKeyDown={onKey}
      />
      <Search />
      {open && query.trim() && (
        <div className="c-search-results" role="listbox">
          {results.length ? results.map((item, index) => (
            <button
              key={item.key}
              role="option"
              aria-selected={index === active}
              className={index === active ? 'is-active' : undefined}
              onMouseDown={event => event.preventDefault()}
              onClick={() => choose(item)}
            >
              <span className="c-truncate">{item.label}</span>
              <span className="c-muted">{item.kind}</span>
            </button>
          )) : <p className="c-empty" style={{ padding: 12 }}>No matches</p>}
        </div>
      )}
    </div>
  );
}

type AuthState = 'checking' | 'ready' | 'login' | 'unconfigured';

function AccessScreen({ state, message }: { state: Exclude<AuthState, 'ready'>; message: string | null }) {
  return (
    <div className="c-app">
      <div className="c-access">
        <div className="c-card">
          <div className="c-brand" style={{ padding: 0 }}>
            <span className="c-brand-mark"><ShieldCheck /></span>
            <span className="c-brand-name">SHAPI</span>
          </div>
          {state === 'checking' ? (
            <p className="c-muted" style={{ marginTop: 20 }}>Checking access…</p>
          ) : state === 'login' ? (
            <>
              <h2 className="c-card-title" style={{ margin: '22px 0 6px' }}>Sign in to continue</h2>
              <p className="c-muted" style={{ margin: '0 0 18px' }}>This dashboard uses your organization&apos;s single sign-on. No API key is stored in the browser.</p>
              <a className="c-btn is-primary" href={`${SHAPI_API}/auth/login`} style={{ color: '#fff', textDecoration: 'none' }}>Sign in with SSO</a>
            </>
          ) : (
            <>
              <h2 className="c-card-title" style={{ margin: '22px 0 6px' }}>Dashboard sign-in is not configured</h2>
              <p className="c-muted" style={{ margin: 0 }}>Configure OIDC for browser sign-in, or provide a tenant API key through the dashboard runtime configuration.</p>
              {message && <p className="c-note is-bad" style={{ marginTop: 12 }}>{message}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function Console() {
  const [authState, setAuthState] = useState<AuthState>(SHAPI_KEY ? 'ready' : 'checking');
  const [authMessage, setAuthMessage] = useState<string | null>(null);

  useEffect(() => {
    const themeColor = document.querySelector('meta[name="theme-color"]');
    themeColor?.setAttribute('content', '#ffffff');
    // The global stylesheet paints a dark body; keep overscroll areas light.
    document.documentElement.style.background = '#ffffff';
    document.body.style.background = '#ffffff';
  }, []);

  useEffect(() => {
    if (SHAPI_KEY) return;
    let active = true;
    const checkAccess = async () => {
      try {
        const sessionResponse = await fetch(`${SHAPI_API}/auth/me`, { credentials: 'include' });
        if (sessionResponse.ok) {
          if (active) setAuthState('ready');
          return;
        }
        const configResponse = await fetch(`${SHAPI_API}/auth/config`, { credentials: 'include' });
        if (!configResponse.ok) throw new Error(`Authentication configuration unavailable (${configResponse.status})`);
        const authConfig = await configResponse.json() as { oidcEnabled?: boolean };
        if (active) setAuthState(authConfig.oidcEnabled ? 'login' : 'unconfigured');
      } catch (error) {
        if (active) {
          setAuthState('unconfigured');
          setAuthMessage(error instanceof Error ? error.message : 'Could not check dashboard access');
        }
      }
    };
    void checkAccess();
    return () => { active = false; };
  }, []);

  return authState === 'ready' ? <Shell /> : <AccessScreen state={authState} message={authMessage} />;
}
