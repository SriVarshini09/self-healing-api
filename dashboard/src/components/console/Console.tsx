// SHAPI console: a quiet, page-per-task dashboard.
// Routes live in the URL hash (#/incidents/<id>) so the static build needs no server routing.
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import {
  BadgeCheck, Bell, BookOpen, Cable, CircleAlert, CircleHelp, Home, ListChecks, LockKeyhole, LogOut, ScrollText, Search, Settings, ShieldCheck,
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
import { SettingsPage } from './pages/Settings';
import { SecurityPage } from './pages/Security';
import { ForgotPassword, ResetPasswordScreen } from './PasswordReset';
import { AcceptInviteScreen } from './AcceptInvite';
import { Landing } from './Landing';
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
  {
    label: 'Setup',
    items: [
      { route: 'connections', label: 'Connections', icon: <Cable /> },
      { route: 'settings', label: 'Settings', icon: <Settings /> },
      { route: 'security', label: 'Security', icon: <LockKeyhole /> },
    ],
  },
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

  // Settings announces a rename; refresh the sidebar's workspace name right away.
  const reloadStats = stats.reload;
  useEffect(() => {
    const onChange = () => void reloadStats();
    window.addEventListener('shapi:workspace-changed', onChange);
    return () => window.removeEventListener('shapi:workspace-changed', onChange);
  }, [reloadStats]);

  // Browser tab title follows the page.
  useEffect(() => {
    const titles: Record<string, string> = {
      incidents: route.split('/')[1] ? 'Incident' : 'Incidents',
      checks: 'Outcome checks',
      rules: 'Rules',
      connections: 'Connections',
      settings: 'Settings',
      security: 'Security',
    };
    document.title = `${titles[section] ?? 'Overview'} · SHAPI`;
  }, [section, route]);

  let page: ReactNode;
  if (section === 'incidents' && route.split('/')[1]) page = <IncidentDetailPage key={route} id={route.split('/')[1]} go={go} />;
  else if (section === 'incidents') page = <IncidentsPage go={go} />;
  else if (section === 'checks') page = <OutcomeChecksPage />;
  else if (section === 'rules') page = <RulesPage />;
  else if (section === 'connections') page = <ConnectionsPage />;
  else if (section === 'settings') page = <SettingsPage />;
  else if (section === 'security') page = <SecurityPage />;
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
      { key: 'p-settings', label: 'Settings', kind: 'Page', route: 'settings' },
      { key: 'p-security', label: 'Security', kind: 'Page', route: 'security' },
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

type AuthConfig = { oidcEnabled: boolean; passwordLogin: boolean; signup: 'closed' | 'invite' | 'open'; passwordReset: boolean };
type AuthState = { status: 'checking' } | { status: 'ready' } | { status: 'signin'; config: AuthConfig } | { status: 'error'; message: string };

async function postAuth(path: string, body: unknown): Promise<void> {
  const response = await fetch(`${SHAPI_API}/${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(failure?.error ?? `Request failed (${response.status})`);
  }
}

function AccessScreen({ state, onSignedIn, initialMode = 'signin' }: {
  state: Exclude<AuthState, { status: 'ready' }>;
  onSignedIn: () => void;
  initialMode?: 'signin' | 'signup';
}) {
  const config = state.status === 'signin' ? state.config : null;
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>(initialMode);
  const [form, setForm] = useState({ workspaceName: '', name: '', email: '', password: '', inviteCode: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { document.title = 'Sign in · SHAPI'; }, []);
  const set = (field: keyof typeof form) => (event: { target: { value: string } }) => setForm(current => ({ ...current, [field]: event.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signin') {
        await postAuth('auth/password/login', { email: form.email, password: form.password });
        window.location.hash = '/overview';
      } else {
        await postAuth('auth/signup', {
          workspaceName: form.workspaceName,
          name: form.name,
          email: form.email,
          password: form.password,
          ...(config?.signup === 'invite' ? { inviteCode: form.inviteCode } : {}),
        });
        window.location.hash = '/overview';
      }
      onSignedIn();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const canSignUp = config ? config.signup !== 'closed' : false;

  return (
    <div className="c-app">
      <div className="c-access">
        <div className="c-card">
          <div className="c-brand" style={{ padding: 0 }}>
            <span className="c-brand-mark"><ShieldCheck /></span>
            <span className="c-brand-name">SHAPI</span>
          </div>
          {state.status === 'checking' && <p className="c-muted" style={{ marginTop: 20 }}>Checking access…</p>}
          {state.status === 'error' && (
            <>
              <h2 className="c-card-title" style={{ margin: '22px 0 6px' }}>Can't reach SHAPI</h2>
              <p className="c-note is-bad">{state.message}</p>
            </>
          )}
          {config && mode === 'forgot' && (
            <ForgotPassword emailEnabled={config.passwordReset} initialEmail={form.email} onBack={() => { setMode('signin'); setError(null); }} />
          )}
          {config && mode !== 'forgot' && (
            <>
              <h2 className="c-card-title" style={{ margin: '22px 0 4px' }}>{mode === 'signin' ? 'Sign in to continue' : 'Create your workspace'}</h2>
              <p className="c-muted" style={{ margin: '0 0 16px' }}>
                {mode === 'signin'
                  ? 'Check that every paying customer actually got access.'
                  : 'Takes a minute. You can connect Stripe right after.'}
              </p>
              {canSignUp && (
                <div className="c-seg" role="tablist" aria-label="Sign in or sign up" style={{ marginBottom: 16 }}>
                  <button type="button" role="tab" aria-selected={mode === 'signin'} onClick={() => { setMode('signin'); setError(null); }}>Sign in</button>
                  <button type="button" role="tab" aria-selected={mode === 'signup'} onClick={() => { setMode('signup'); setError(null); }}>Create workspace</button>
                </div>
              )}
              <form onSubmit={event => void submit(event)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {mode === 'signup' && (
                  <>
                    <label className="c-field"><span className="c-label">Workspace name</span>
                      <input className="c-input" value={form.workspaceName} onChange={set('workspaceName')} placeholder="Acme Inc." required minLength={2} maxLength={80} autoComplete="organization" />
                    </label>
                    <label className="c-field"><span className="c-label">Your name</span>
                      <input className="c-input" value={form.name} onChange={set('name')} required maxLength={80} autoComplete="name" />
                    </label>
                  </>
                )}
                <label className="c-field"><span className="c-label">Work email</span>
                  <input className="c-input" type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
                </label>
                <label className="c-field"><span className="c-label">Password</span>
                  <input
                    className="c-input" type="password" value={form.password} onChange={set('password')} required
                    minLength={mode === 'signup' ? 10 : 1} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  />
                  {mode === 'signup' && <span className="c-hint">At least 10 characters.</span>}
                  {mode === 'signin' && (
                    <button type="button" className="c-hint" onClick={() => { setMode('forgot'); setError(null); }}
                      style={{ alignSelf: 'flex-end', background: 'none', border: 0, padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>
                      Forgot password?
                    </button>
                  )}
                </label>
                {mode === 'signup' && config.signup === 'invite' && (
                  <label className="c-field"><span className="c-label">Invite code</span>
                    <input className="c-input" value={form.inviteCode} onChange={set('inviteCode')} required autoComplete="off" />
                    <span className="c-hint">SHAPI is in private beta. Ask the team for a code.</span>
                  </label>
                )}
                {error && <p className="c-note is-bad">{error}</p>}
                <button className="c-btn is-primary" type="submit" disabled={busy}>
                  {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create workspace'}
                </button>
              </form>
              <p className="c-hint" style={{ display: 'flex', justifyContent: 'center', gap: 16, margin: '14px 0 0' }}>
                <a href="#/">About SHAPI</a>
                <a href="#/security">How SHAPI handles your data</a>
              </p>
              {config.oidcEnabled && (
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span className="c-hint" style={{ textAlign: 'center' }}>or</span>
                  <a className="c-btn" href={`${SHAPI_API}/auth/login`} style={{ color: 'var(--c-ink)', textDecoration: 'none' }}>Sign in with SSO</a>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function Console() {
  const [authState, setAuthState] = useState<AuthState>(SHAPI_KEY ? { status: 'ready' } : { status: 'checking' });

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
          if (active) setAuthState({ status: 'ready' });
          return;
        }
        const configResponse = await fetch(`${SHAPI_API}/auth/config`, { credentials: 'include' });
        if (!configResponse.ok) throw new Error(`Authentication configuration unavailable (${configResponse.status})`);
        const raw = await configResponse.json() as Partial<AuthConfig>;
        if (active) {
          setAuthState({
            status: 'signin',
            config: {
              oidcEnabled: Boolean(raw.oidcEnabled),
              passwordLogin: raw.passwordLogin !== false,
              signup: raw.signup ?? 'closed',
              passwordReset: Boolean(raw.passwordReset),
            },
          });
        }
      } catch (error) {
        if (active) setAuthState({ status: 'error', message: error instanceof Error ? error.message : 'Could not check dashboard access' });
      }
    };
    void checkAccess();
    return () => { active = false; };
  }, []);

  const [route] = useRoute();
  if (route.startsWith('reset-password')) {
    // From the emailed link; works signed in or out.
    return <ResetPasswordScreen token={new URLSearchParams(route.split('?')[1] ?? '').get('token') ?? ''} />;
  }
  if (route.startsWith('accept-invite')) {
    return <AcceptInviteScreen token={new URLSearchParams(route.split('?')[1] ?? '').get('token') ?? ''} />;
  }
  if (authState.status !== 'ready' && route === 'security') {
    // Readable before signing up: it only calls the public /trust endpoint.
    return <div className="c-app"><main className="c-main"><div className="c-content" style={{ maxWidth: 1000, width: '100%', margin: '0 auto' }}><SecurityPage signedOut /></div></main></div>;
  }
  if (authState.status === 'ready') return <Shell />;
  // Signed-out visitors see the landing page; sign-in lives at #/signin.
  if (authState.status === 'signin' && !route.startsWith('signin')) return <Landing signup={authState.config.signup} />;
  return (
    <AccessScreen
      // Remount when the requested mode changes (e.g. #/signin -> #/signin?mode=signup).
      key={route.includes('mode=signup') ? 'signup' : 'signin'}
      state={authState}
      initialMode={route.includes('mode=signup') ? 'signup' : 'signin'}
      onSignedIn={() => setAuthState({ status: 'ready' })}
    />
  );
}
