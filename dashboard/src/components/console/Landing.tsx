// Public landing page for signed-out visitors. Every claim here is backed by
// something in the repository (benchmark/, the Stripe change monitor, SECURITY.md).
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, BellRing, Check, Database, GitCompareArrows, Lock, PlugZap, ShieldCheck } from 'lucide-react';
import { SHAPI_API } from '@/lib/shapi-api';
import './landing.css';

const REPO = 'https://github.com/SriVarshini09/self-healing-api';
const SAMPLE_SQL = `SELECT 1 FROM users
WHERE stripe_customer_id = :customer
  AND plan_status = 'active'`;

type Signup = 'closed' | 'invite' | 'open';

// The URL hash holds the console's route, so in-page links scroll instead of navigating.
const scrollTo = (id: string) => (event: { preventDefault: () => void }) => {
  event.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function RequestInvite() {
  const [form, setForm] = useState({ email: '', name: '', company: '', note: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (field: keyof typeof form) => (event: { target: { value: string } }) => setForm(current => ({ ...current, [field]: event.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${SHAPI_API}/invite-requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(failure?.error ?? `Request failed (${response.status})`);
      }
      setDone(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="l-invite-done">
        <span className="l-check"><Check /></span>
        <div>
          <p className="c-strong" style={{ margin: 0 }}>Thanks, we'll be in touch.</p>
          <p className="c-muted" style={{ margin: '4px 0 0' }}>We'll email you with an invite code and help with setup.</p>
        </div>
      </div>
    );
  }
  return (
    <form className="l-invite-form" onSubmit={event => void submit(event)}>
      <label className="c-field"><span className="c-label">Work email</span>
        <input className="c-input" type="email" required maxLength={200} value={form.email} onChange={set('email')} autoComplete="email" placeholder="you@company.com" />
      </label>
      <div className="l-invite-row">
        <label className="c-field"><span className="c-label">Name</span>
          <input className="c-input" maxLength={80} value={form.name} onChange={set('name')} autoComplete="name" />
        </label>
        <label className="c-field"><span className="c-label">Company or website</span>
          <input className="c-input" maxLength={120} value={form.company} onChange={set('company')} autoComplete="organization" />
        </label>
      </div>
      <label className="c-field"><span className="c-label">How do customers get access after paying? <span className="c-muted">(optional)</span></span>
        <textarea className="c-textarea" rows={2} maxLength={1000} value={form.note} onChange={set('note')} placeholder="e.g. Stripe Checkout, a webhook in Next.js sets users.plan in Postgres" />
      </label>
      {/* Honeypot: hidden from people; bots fill it in. */}
      <input className="l-hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={form.website} onChange={set('website')} name="website" />
      {error && <p className="c-note is-bad" style={{ margin: 0 }}>{error}</p>}
      <div className="l-invite-actions">
        <button className="c-btn is-primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Request an invite'}</button>
        <span className="c-hint">We only use this to contact you about the beta.</span>
      </div>
    </form>
  );
}

export function Landing({ signup }: { signup: Signup | null }) {
  const createLabel = signup === 'open' ? 'Create a workspace' : 'I have an invite code';
  useEffect(() => { document.title = 'SHAPI — Stripe says paid. Did the customer get access?'; }, []);
  return (
    <div className="c-app l-page">
      <header className="l-nav">
        <a className="l-brand" href="#/"><span className="c-brand-mark"><ShieldCheck /></span><span className="c-brand-name">SHAPI</span></a>
        <nav className="l-nav-links">
          <a href="#how" onClick={scrollTo('how')}>How it works</a>
          <a href="#/security">Security</a>
          <a className="c-btn" href="#/signin">Sign in</a>
        </nav>
      </header>

      <main>
        <section className="l-hero">
          <span className="c-pill is-info">Private beta · Stripe + Postgres</span>
          <h1>Stripe says paid.<br />Did the customer get access?</h1>
          <p className="l-lead">
            Your webhook returned 200, but the account never got upgraded. Nobody gets an error, and nobody finds out
            until the customer emails you. SHAPI checks your own database after every Stripe payment and tells you,
            by customer, the moment someone paid and didn't get what they paid for.
          </p>
          <div className="l-cta">
            <a className="c-btn is-primary" href="#request" onClick={scrollTo('request')}>Request an invite <ArrowRight /></a>
            {signup !== 'closed' && <a className="c-btn" href="#/signin?mode=signup">{createLabel}</a>}
          </div>
        </section>

        <section className="l-proof">
          <div className="l-stat is-mint">
            <span className="l-stat-num">9 of 10</span>
            <span>provisioning bugs caught when we broke the official Next.js SaaS starter on purpose, with 0 false alarms.</span>
          </div>
          <div className="l-stat is-peach">
            <span className="l-stat-num">9 of 10</span>
            <span>of those bugs still answered Stripe with HTTP 200, invisible to uptime and error monitoring. SHAPI caught 8 of them.</span>
          </div>
          <div className="l-stat is-lavender">
            <span className="l-stat-num">1 real bug</span>
            <span>in the unmodified starter: after a plan upgrade, the old plan name stays in the database. <a href={`${REPO}/tree/master/benchmark`} target="_blank" rel="noreferrer">See the benchmark</a></span>
          </div>
        </section>

        <section className="l-section" id="how">
          <h2>How it works</h2>
          <div className="l-steps">
            <div className="l-step">
              <span className="c-icon-tile is-info"><PlugZap /></span>
              <h3>1. Connect Stripe</h3>
              <p>Point a Stripe webhook at SHAPI, or give it a restricted key that can only read events. No SDK and no code changes.</p>
            </div>
            <div className="l-step">
              <span className="c-icon-tile is-ok"><Database /></span>
              <h3>2. Say what "provisioned" means</h3>
              <p>One read-only query against your database, filled in from the Stripe event:</p>
              <pre className="l-code">{SAMPLE_SQL}</pre>
            </div>
            <div className="l-step">
              <span className="c-icon-tile is-warn"><BellRing /></span>
              <h3>3. Hear about it first</h3>
              <p>When a payment has no matching row by the deadline, you get one Slack or email alert naming the customer and the Stripe event, and what to fix.</p>
            </div>
          </div>
        </section>

        <section className="l-section l-split">
          <div className="l-panel is-blue">
            <span className="c-icon-tile is-info"><GitCompareArrows /></span>
            <h3>It watches Stripe too</h3>
            <p>
              When Stripe upgrades your webhook API version or a field moves (like <code>invoice.subscription</code> in the 2025 "basil"
              release), SHAPI notices from the webhooks themselves and tells you which of your checks read that field.
            </p>
          </div>
          <div className="l-panel is-mint">
            <span className="c-icon-tile is-ok"><Lock /></span>
            <h3>Built to be trusted with a database URL</h3>
            <p>
              Queries run read-only with a 5-second limit and are always rolled back. SHAPI only learns whether a row exists, never
              its values. Credentials are encrypted at rest. <a href="#/security">Read exactly what we store</a>.
            </p>
          </div>
        </section>

        <section className="l-section l-request" id="request">
          <div>
            <h2>Request an invite</h2>
            <p className="c-muted">
              SHAPI is in a small private beta for SaaS teams that bill with Stripe and provision in Postgres.
              Setup takes about 15 minutes.
            </p>
          </div>
          <div className="c-card l-invite-card"><RequestInvite /></div>
        </section>
      </main>

      <footer className="l-footer">
        <span>© SHAPI</span>
        <a href="#/security">Security</a>
        <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>
        <a href="#/signin">Sign in</a>
      </footer>
    </div>
  );
}
