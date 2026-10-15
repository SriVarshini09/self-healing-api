// "Forgot password": ask for a link (inside the sign-in card), then choose a
// new password from the emailed link (#/reset-password?token=...).
import { useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { SHAPI_API } from '@/lib/shapi-api';

async function post(path: string, body: unknown): Promise<void> {
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

/** Shown in the sign-in card in place of the sign-in form. */
export function ForgotPassword({ emailEnabled, initialEmail, onBack }: { emailEnabled: boolean; initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('auth/password/forgot', { email });
      setSent(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const back = <button type="button" className="c-btn is-quiet" onClick={onBack}>Back to sign in</button>;
  return (
    <>
      <h2 className="c-card-title" style={{ margin: '22px 0 4px' }}>Reset your password</h2>
      {!emailEnabled ? (
        <>
          <p className="c-muted" style={{ margin: '0 0 16px' }}>
            Password reset by email isn't set up on this SHAPI instance yet. Ask the person who runs it for a reset link.
          </p>
          {back}
        </>
      ) : sent ? (
        <>
          <p className="c-note is-ok" style={{ margin: '12px 0 16px' }}>
            If an account exists for {email}, we've sent a reset link. It works once, within an hour. Check your spam folder too.
          </p>
          {back}
        </>
      ) : (
        <>
          <p className="c-muted" style={{ margin: '0 0 16px' }}>Enter your email and we'll send you a link to choose a new password.</p>
          <form onSubmit={event => void submit(event)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label className="c-field"><span className="c-label">Work email</span>
              <input className="c-input" type="email" value={email} onChange={event => setEmail(event.target.value)} required autoComplete="email" autoFocus />
            </label>
            {error && <p className="c-note is-bad">{error}</p>}
            <button className="c-btn is-primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
            {back}
          </form>
        </>
      )}
    </>
  );
}

/** Full screen at #/reset-password?token=... from the emailed link. */
export function ResetPasswordScreen({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      setError("The two passwords don't match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await post('auth/password/reset', { token, password });
      // Signed in now; load the console from a clean URL so the token is gone from history.
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
          <h2 className="c-card-title" style={{ margin: '22px 0 4px' }}>Choose a new password</h2>
          {!token ? (
            <p className="c-note is-bad" style={{ marginTop: 12 }}>This reset link is incomplete. Open the link from your email again, or ask for a new one.</p>
          ) : (
            <>
              <p className="c-muted" style={{ margin: '0 0 16px' }}>You'll be signed in, and signed out on every other device.</p>
              <form onSubmit={event => void submit(event)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label className="c-field"><span className="c-label">New password</span>
                  <input className="c-input" type="password" value={password} onChange={event => setPassword(event.target.value)} required minLength={10} maxLength={200} autoComplete="new-password" autoFocus />
                  <span className="c-hint">At least 10 characters.</span>
                </label>
                <label className="c-field"><span className="c-label">Repeat it</span>
                  <input className="c-input" type="password" value={confirm} onChange={event => setConfirm(event.target.value)} required minLength={10} maxLength={200} autoComplete="new-password" />
                </label>
                {error && <p className="c-note is-bad">{error}</p>}
                <button className="c-btn is-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save and sign in'}</button>
              </form>
            </>
          )}
          <a className="c-hint" href="#/signin" style={{ display: 'block', marginTop: 14, textAlign: 'center' }}>Back to sign in</a>
        </div>
      </div>
    </div>
  );
}
