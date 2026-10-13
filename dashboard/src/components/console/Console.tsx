// SHAPI console: a calm, page-per-task dashboard.
// Routes live in the URL hash (#/incidents/<id>) so the static build needs no server routing.
import { useEffect, useState, type ReactNode } from 'react';
import { Cable, CircleAlert, LayoutDashboard, ListChecks, ScrollText } from 'lucide-react';
import { SHAPI_API, SHAPI_KEY } from '@/lib/shapi-api';
import { OPEN_STATUSES, type Incident } from './types';
import { useShapi } from './ui';
import { OverviewPage } from './pages/Overview';
import { IncidentsPage } from './pages/Incidents';
import { IncidentDetailPage } from './pages/IncidentDetail';
import { OutcomeChecksPage } from './pages/OutcomeChecks';
import { RulesPage } from './pages/Rules';
import { ConnectionsPage } from './pages/Connections';
import './console.css';

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

const NAV: Array<{ route: string; label: string; icon: ReactNode }> = [
  { route: 'overview', label: 'Overview', icon: <LayoutDashboard /> },
  { route: 'incidents', label: 'Incidents', icon: <CircleAlert /> },
  { route: 'checks', label: 'Outcome checks', icon: <ListChecks /> },
  { route: 'rules', label: 'Rules', icon: <ScrollText /> },
  { route: 'connections', label: 'Connections', icon: <Cable /> },
];

function Shell() {
  const [route, go] = useRoute();
  const incidents = useShapi<{ data: Incident[] }>('incidents?pageSize=100', 30_000);
  const openCount = (incidents.data?.data ?? []).filter(incident => OPEN_STATUSES.includes(incident.status)).length;
  const section = route.split('/')[0];

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
          <span className="c-brand-mark">S</span>
          <div>
            <div className="c-brand-name">SHAPI</div>
            <div className="c-brand-sub">Outcome monitoring</div>
          </div>
        </div>
        <nav aria-label="Main">
          {NAV.map(item => (
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
        </nav>
        <div className="c-sidebar-foot">
          <div><span className={`c-live-dot${incidents.error ? ' is-off' : ''}`} />{incidents.error ? 'API unreachable' : 'Connected'}</div>
          {!SHAPI_KEY && <button className="c-btn is-quiet" style={{ marginTop: 8, paddingLeft: 0 }} onClick={() => void signOut()}>Sign out</button>}
        </div>
      </aside>
      <main className="c-main">{page}</main>
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
            <span className="c-brand-mark">S</span>
            <div><div className="c-brand-name">SHAPI</div><div className="c-brand-sub">Outcome monitoring</div></div>
          </div>
          {state === 'checking' ? (
            <p className="c-muted" style={{ marginTop: 20 }}>Checking access…</p>
          ) : state === 'login' ? (
            <>
              <h2 style={{ margin: '22px 0 6px', fontSize: 17 }}>Sign in to continue</h2>
              <p className="c-muted" style={{ margin: '0 0 18px' }}>This dashboard uses your organization&apos;s single sign-on. No API key is stored in the browser.</p>
              <a className="c-btn is-primary" href={`${SHAPI_API}/auth/login`}>Sign in with SSO</a>
            </>
          ) : (
            <>
              <h2 style={{ margin: '22px 0 6px', fontSize: 17 }}>Dashboard sign-in is not configured</h2>
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
    themeColor?.setAttribute('content', '#f5f6f8');
    // The global stylesheet paints a dark body; keep overscroll areas pale too.
    document.documentElement.style.background = '#f5f6f8';
    document.body.style.background = '#f5f6f8';
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
