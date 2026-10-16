import { useEffect, type ReactNode } from 'react';
import { Card, PageHeader, useShapi } from './ui';
import type { Trust } from './pages/Security';

// Public (signed in or out). Plain-language beta terms and privacy notice that
// describe what the product actually does; see SECURITY.md for the technical detail.
// Draft: have a lawyer review before paid plans or EU/UK customers.

const REPO = 'https://github.com/SriVarshini09/self-healing-api';
const EFFECTIVE = '16 October 2026';

type LegalTrust = Trust & { retentionDays?: number; contactEmail?: string };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card title={title}>
      <div className="c-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10, lineHeight: '20px' }}>{children}</div>
    </Card>
  );
}

function Contact({ email }: { email?: string }) {
  return email
    ? <a href={`mailto:${email}`}>{email}</a>
    : <span>the contact address the operator of this SHAPI instance gave you (or <a href={`${REPO}/issues`} target="_blank" rel="noreferrer">open an issue</a>, without sensitive details)</span>;
}

function LegalShell({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  // These pages render outside the console shell, which normally owns the tab title.
  useEffect(() => { document.title = `${title} · SHAPI`; }, [title]);
  return (
    <div className="c-app">
      <main className="c-main">
        <div className="c-content" style={{ maxWidth: 820, width: '100%', margin: '0 auto' }}>
          <div className="c-page">
            <PageHeader
              title={title}
              sub={sub}
              actions={<a className="c-btn" href="#/" style={{ textDecoration: 'none', color: 'var(--c-ink)' }}>Back</a>}
            />
            {children}
            <p className="c-hint" style={{ display: 'flex', gap: 16, margin: '8px 0 24px' }}>
              <a href="#/terms">Terms</a>
              <a href="#/privacy">Privacy</a>
              <a href="#/security">Security</a>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

export function PrivacyPage() {
  const trust = useShapi<LegalTrust>('trust');
  const days = trust.data?.retentionDays ?? 90;
  const email = trust.data?.contactEmail;

  return (
    <LegalShell title="Privacy" sub={`How SHAPI handles your data during the private beta. Effective ${EFFECTIVE}.`}>
      <Section title="The short version">
        <p>SHAPI checks, after each Stripe payment event, that your own database shows the customer got what they paid for.
          To do that it stores your Stripe events, the results of your checks, and the credentials you give it (encrypted).
          It does not sell data, run ads, or use analytics or tracking cookies.</p>
        <p>For the technical detail (encryption, what a check can read, network access) read <a href="#/security">Security</a>.</p>
      </Section>

      <Section title="What we collect">
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <li><strong>Account:</strong> your name, email address and a scrypt hash of your password (never the password itself), your workspace name, and the people you invite.</li>
          <li><strong>Connections you add:</strong> database URLs, Stripe restricted keys and Slack webhook URLs, stored encrypted and never shown again. Stripe webhook signing secrets are stored without field-level encryption.</li>
          <li><strong>Stripe events you send us:</strong> what Stripe puts in them, which can include your customers' email addresses and ids. We store them so checks can run and incidents can show what happened.</li>
          <li><strong>Check results:</strong> whether a row existed, plus the values filled in from the event (such as a customer id). Your query is wrapped so column values never leave your database.</li>
          <li><strong>Learned Stripe event shapes:</strong> field names and value kinds per event type, never the values.</li>
          <li><strong>Alerts:</strong> the email addresses and Slack webhooks you add as destinations, and a record of each alert sent.</li>
          <li><strong>Beta requests:</strong> the email, name, company and note you submit on the landing page.</li>
          <li><strong>Technical:</strong> one HttpOnly session cookie when you sign in, and server logs (request path, status, errors) used to run and debug the service.</li>
        </ul>
      </Section>

      <Section title="Your customers' data">
        <p>Stripe events can contain personal data about <em>your</em> customers. For that data you decide why it is processed and SHAPI
          acts on your behalf: we use it only to run your checks and show you incidents, and we don't use it for anything else.
          You are responsible for having a lawful basis to send it to us. If you need a data processing agreement, ask at the contact address below.</p>
      </Section>

      <Section title="Who else sees it">
        <p>SHAPI is run on a small set of providers, each only for what it is needed for:</p>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <li>Hosting and database: the cloud provider the operator runs the service and its PostgreSQL database on.</li>
          <li>Email (invites, password resets, alerts): Resend, when the operator has enabled it. They see the recipient and the message.</li>
          <li>Slack: only the alerts you send to your own Slack webhook.</li>
          <li>Stripe: SHAPI calls Stripe's API with the restricted key you provide, read-only.</li>
          <li>GitHub: only if you connect repair pull requests.</li>
        </ul>
        <p>We don't share data with anyone else unless the law requires it.</p>
      </Section>

      <Section title="How long we keep it">
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <li>Stripe events, tracked events and finished check runs are deleted automatically after {days} days. Closed incidents go with them. Events an open incident still needs are kept until it closes.</li>
          <li><strong>Delete workspace</strong> (Settings, Owner only) removes everything in the workspace at once: connections and credentials, events, incidents, checks, alert destinations, people, sessions and API keys.</li>
          <li>Deleting a check deletes its stored credentials.</li>
          <li>Backups made by the operator may hold deleted data until they rotate out.</li>
          <li>Beta requests are kept until we've contacted you or you ask us to delete them.</li>
        </ul>
      </Section>

      <Section title="Your choices">
        <p>You can see, correct and delete most of your data in the dashboard. For anything else, such as a copy of your data or deletion of a beta request,
          write to <Contact email={email} /> and we'll act on it within 30 days. You can also report a security problem privately through{' '}
          <a href={`${REPO}/security/advisories/new`} target="_blank" rel="noreferrer">GitHub's private vulnerability reporting</a>.</p>
      </Section>

      <Section title="Honest limits">
        <p>SHAPI is a private beta from a very small team. It has no third-party security audit or SOC 2 report. It is not meant for children, or for
          data you are not allowed to share with a service provider (for example card numbers or health records: Stripe events don't carry card numbers, but don't send
          them if yours do). We'll update this page when something changes and change the date above; if the change matters to you, we'll email workspace Owners.</p>
      </Section>
    </LegalShell>
  );
}

export function TermsPage() {
  const trust = useShapi<LegalTrust>('trust');
  const email = trust.data?.contactEmail;

  return (
    <LegalShell title="Terms" sub={`Terms for the SHAPI private beta. Effective ${EFFECTIVE}.`}>
      <Section title="What this is">
        <p>These terms cover your use of SHAPI during the private beta. By creating a workspace or using the service you agree to them.
          If you use SHAPI for a company, you confirm you can accept these terms for it. The beta is free; if that changes, we'll tell you
          first and you can leave without paying. Paid plans will come with updated terms.</p>
      </Section>

      <Section title="The beta, honestly">
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <li>SHAPI is early software. It can be wrong: it can miss a failure or report one that isn't real.</li>
          <li>Don't rely on it as your only safeguard. Keep your own monitoring, alerts and reconciliation.</li>
          <li>There is no uptime guarantee or support commitment. We'll try to fix problems quickly and tell you about incidents that affect you.</li>
          <li>Features can change or be removed. We may pause or end the beta, with notice where we can.</li>
        </ul>
      </Section>

      <Section title="Your account and your data">
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <li>Keep your password and API keys safe. You're responsible for what happens under your account and for the people you invite.</li>
          <li>Your data stays yours. You give us permission to store and process it only to provide SHAPI to you, as described in the <a href="#/privacy">Privacy</a> page.</li>
          <li>You must have the right to connect what you connect: your own Stripe account and database, or ones you're authorised to use.</li>
          <li>Use a read-only database user and a restricted, read-only Stripe key, as the <a href={`${REPO}/blob/master/docs/QUICK-SETUP.md`} target="_blank" rel="noreferrer">setup guide</a> explains. SHAPI refuses live secret keys, but what you grant is your decision.</li>
          <li>You can delete your workspace at any time in Settings (Owner only). That deletes your data, as the Privacy page describes.</li>
        </ul>
      </Section>

      <Section title="What you agree not to do">
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <li>Probe, attack or overload the service, or try to reach another workspace's data. To report a weakness, use <a href={`${REPO}/security/advisories/new`} target="_blank" rel="noreferrer">private vulnerability reporting</a>; good-faith reports are welcome.</li>
          <li>Point SHAPI at systems you don't own or aren't allowed to query, or use it to scan networks.</li>
          <li>Break the law, or send data you're not allowed to share.</li>
          <li>Resell the service or build a competing product from its outputs.</li>
        </ul>
        <p>SHAPI's code is public on <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>. Reading it is fine; the repository's own licence terms (or lack of one) govern reuse.</p>
      </Section>

      <Section title="Liability">
        <p>SHAPI is provided "as is" and "as available", without warranties of any kind to the extent the law allows. We are not responsible for
          failures SHAPI doesn't detect, for false alarms, or for losses that follow from relying on it. To the extent the law allows, our total
          liability for any claim is limited to what you paid us in the 12 months before it, which during the free beta is zero. Nothing here limits
          liability that can't be limited by law.</p>
      </Section>

      <Section title="Ending things">
        <p>You can stop at any time by deleting your workspace. We may suspend or end access if you break these terms or put the service or other people at risk,
          and we'll tell you why when we can. Sections that by nature should survive (liability, what you agree not to do) do.</p>
      </Section>

      <Section title="Changes and contact">
        <p>We'll update these terms as the product grows and change the date above. If a change matters to you, we'll email workspace Owners before it applies.
          Questions: <Contact email={email} />.</p>
        <p className="c-hint">This is a plain-language beta draft. It will be reviewed by a lawyer before paid plans, and the governing law and operating entity will be stated then.</p>
      </Section>
    </LegalShell>
  );
}
