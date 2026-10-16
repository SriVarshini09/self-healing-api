import type { ReactNode } from 'react';
import { Database, KeyRound, Lock, Network, ShieldAlert } from 'lucide-react';
import { Card, PageHeader, Pill, useShapi } from '../ui';

export type Trust = { egressIps: string[]; dedicatedEncryptionKey: boolean; privateDatabaseHostsBlocked: boolean; retentionDays?: number };

const REPO = 'https://github.com/SriVarshini09/self-healing-api';
const SETUP_GUIDE = `${REPO}/blob/master/docs/QUICK-SETUP.md`;

/** The IPs to allowlist, as shown wherever a database URL is entered. */
export function EgressIps({ trust }: { trust: Trust | null }) {
  if (!trust) return null;
  if (!trust.egressIps.length) {
    return <span className="c-hint">This SHAPI instance hasn't published its outbound IPs yet. If your database only accepts listed IPs, ask the operator for them.</span>;
  }
  return (
    <span className="c-hint">
      If your database only accepts listed IPs, allow {trust.egressIps.length === 1 ? 'this address' : 'these addresses'}:{' '}
      {trust.egressIps.map((ip, index) => <span key={ip}>{index ? ', ' : ''}<code>{ip}</code></span>)}
    </span>
  );
}

function Fact({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="c-list-row" style={{ alignItems: 'flex-start' }}>
      <span className="c-icon-tile">{icon}</span>
      <div className="c-grow" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="c-strong">{title}</span>
        <span className="c-muted c-small">{children}</span>
      </div>
    </div>
  );
}

export function SecurityPage({ signedOut = false }: { signedOut?: boolean }) {
  const trust = useShapi<Trust>('trust');
  const t = trust.data;

  return (
    <div className="c-page">
      <PageHeader
        title="Security"
        sub="What SHAPI can see, what it stores and how, before you connect a database."
        actions={signedOut ? <a className="c-btn" href="#/" style={{ textDecoration: 'none', color: 'var(--c-ink)' }}>Back</a> : undefined}
      />

      <Card title="Your database" sub="Outcome checks ask one question: does the row that proves this customer was provisioned exist?">
        <div className="c-list">
          <Fact icon={<Database />} title="SHAPI only learns whether a row exists">
            Your query is wrapped as <code>SELECT 1 FROM (your query) LIMIT 1</code>, so column values never leave your database.
            The values SHAPI fills in from the Stripe event (such as the customer id) are stored with each check result.
          </Fact>
          <Fact icon={<Lock />} title="Read-only, time-limited, always rolled back">
            Only a single <code>SELECT</code> (or <code>WITH … SELECT</code>) is accepted. It runs inside a <code>READ ONLY</code> transaction
            with a 5-second statement timeout and is rolled back afterwards. Still, connect with a read-only user that can only
            read the tables your checks use: the <a href={SETUP_GUIDE} target="_blank" rel="noreferrer">setup guide</a> has the exact SQL.
          </Fact>
          <Fact icon={<Network />} title="Network">
            <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span>Add <code>sslmode=require</code> to your database URL so the connection is encrypted in transit.</span>
              {t && <EgressIps trust={t} />}
              {t && (
                <span className="c-row" style={{ gap: 6 }}>
                  <Pill tone={t.privateDatabaseHostsBlocked ? 'ok' : 'warn'}>{t.privateDatabaseHostsBlocked ? 'On' : 'Off'}</Pill>
                  Refuses databases on private or internal addresses, checked on every run{t.privateDatabaseHostsBlocked ? '' : ' (off on this instance; normal for self-hosted SHAPI inside your network)'}.
                </span>
              )}
            </span>
          </Fact>
        </div>
      </Card>

      <Card title="What SHAPI stores" sub="Credentials you give SHAPI are encrypted before they are saved and are never shown again.">
        <div className="c-list">
          <Fact icon={<KeyRound />} title="Database URLs, Stripe keys, Slack webhook URLs: AES-256-GCM">
            <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span>The dashboard shows only the host and database name. Deleting a check deletes its stored credentials.</span>
              {t && (
                <span className="c-row" style={{ gap: 6 }}>
                  <Pill tone={t.dedicatedEncryptionKey ? 'ok' : 'warn'}>{t.dedicatedEncryptionKey ? 'Dedicated key' : 'Shared key'}</Pill>
                  {t.dedicatedEncryptionKey
                    ? 'Encrypted with a key used only for stored secrets.'
                    : 'Encrypted with a key derived from the sign-in secret; the operator should set a dedicated one.'}
                </span>
              )}
            </span>
          </Fact>
          <Fact icon={<KeyRound />} title="Stripe: read-only, least access">
            SHAPI asks for a restricted key with read access to Events only. Live secret keys (<code>sk_live_</code>) are refused.
            The webhook signing secret is stored in SHAPI's database without field encryption: it lets someone send events to SHAPI,
            not read anything from your Stripe account.
          </Fact>
          <Fact icon={<Database />} title="Stripe events you send to SHAPI">
            Stored so checks can run and incidents can show what happened. They contain what Stripe puts in them, which can
            include customer emails. They are deleted automatically after {t?.retentionDays ?? 90} days (closed incidents too; open
            incidents keep what they need). Deleting your workspace in Settings removes everything right away.
            To spot Stripe changes, SHAPI also keeps each event type's field names and value kinds, never the values.
          </Fact>
          <Fact icon={<Lock />} title="Accounts">
            Passwords are hashed with scrypt. API keys and session tokens are stored only as SHA-256 hashes. Sessions use
            HttpOnly, SameSite cookies, and every workspace's data is scoped to that workspace on every request.
          </Fact>
        </div>
      </Card>

      <Card title="Found a problem?">
        <div className="c-list">
          <Fact icon={<ShieldAlert />} title="Report a vulnerability privately">
            Use <a href={`${REPO}/security/advisories/new`} target="_blank" rel="noreferrer">GitHub's private vulnerability reporting</a> rather
            than a public issue. SHAPI's code is public, so you can read exactly what runs: start with the{' '}
            <a href={`${REPO}/blob/master/packages/outcome-checks/src/runner.ts`} target="_blank" rel="noreferrer">query runner</a>.
          </Fact>
        </div>
      </Card>
    </div>
  );
}
