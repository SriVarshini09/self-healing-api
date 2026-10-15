// Joining a workspace from an invite link: #/accept-invite?token=...
import { useEffect, useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { SHAPI_API } from '@/lib/shapi-api';

type Preview = { workspace: string; email: string; role: string; invitedBy: string | null };

const ROLE_TEXT: Record<string, string> = {
  ADMIN: 'an Admin',
  OPERATOR: 'an Operator',
  VIEWER: 'a Viewer (read only)',
};

export function AcceptInviteScreen({ token }: { token: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(token ? null : 'This invite link is incomplete. Open the link from your email again.');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    void (async () => {
      const response = await fetch(`${SHAPI_API}/auth/invites/${encodeURIComponent(token)}`, { credentials: 'include' }).catch(() => null);
      const body = (await response?.json().catch(() => null)) as (Preview & { error?: string }) | null;
      if (!active) return;
      if (response?.ok && body) setPreview(body);
      else setLoadError(body?.error ?? 'Could not load this invite. Try the link again.');
    })();
    return () => { active = false; };
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${SHAPI_API}/auth/invites/accept`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, name: name.trim(), password }),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(failure?.error ?? `Request failed (${response.status})`);
      }
      // Signed in; open the workspace from a clean URL so the token leaves the address bar.
      window.location.replace(`${window.location.pathname}#/overview`);
      window.location.reload();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Something went wrong');
      setBusy(false);
    }
  };

  return (
    <div className="c-app">
      <div className="c-access">
        <div className="c-card">
          <div className="c-brand" style={{ padding: 0 }}>
            <span className="c-brand-mark"><ShieldCheck /></span>
            <span className="c-brand-name">SHAPI</span>
          </div>
          {loadError ? (
            <>
              <h2 className="c-card-title" style={{ margin: '22px 0 6px' }}>Invite not available</h2>
              <p className="c-note is-bad">{loadError}</p>
            </>
          ) : !preview ? (
            <p className="c-muted" style={{ marginTop: 20 }}>Checking your invite…</p>
          ) : (
            <>
              <h2 className="c-card-title" style={{ margin: '22px 0 4px' }}>Join {preview.workspace}</h2>
              <p className="c-muted" style={{ margin: '0 0 16px' }}>
                {preview.invitedBy ? `${preview.invitedBy} invited you` : "You've been invited"} as {ROLE_TEXT[preview.role] ?? preview.role.toLowerCase()}.
              </p>
              <form onSubmit={event => void submit(event)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label className="c-field"><span className="c-label">Email</span>
                  <input className="c-input" value={preview.email} readOnly disabled />
                </label>
                <label className="c-field"><span className="c-label">Your name</span>
                  <input className="c-input" value={name} onChange={event => setName(event.target.value)} required maxLength={80} autoComplete="name" autoFocus />
                </label>
                <label className="c-field"><span className="c-label">Choose a password</span>
                  <input className="c-input" type="password" value={password} onChange={event => setPassword(event.target.value)} required minLength={10} maxLength={200} autoComplete="new-password" />
                  <span className="c-hint">At least 10 characters.</span>
                </label>
                {error && <p className="c-note is-bad">{error}</p>}
                <button className="c-btn is-primary" type="submit" disabled={busy}>{busy ? 'Joining…' : 'Join workspace'}</button>
              </form>
            </>
          )}
          <a className="c-hint" href="#/signin" style={{ display: 'block', marginTop: 14, textAlign: 'center' }}>Already have an account? Sign in</a>
        </div>
      </div>
    </div>
  );
}
