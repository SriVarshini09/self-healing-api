import { ArrowRightLeft, CircleMinus, GitCompareArrows } from 'lucide-react';
import { Card, Empty, Pill, timeAgo, useShapi } from '../ui';

export type StripeChange = {
  id: string;
  kind: 'API_VERSION' | 'FIELD_REMOVED' | 'TYPE_CHANGED';
  eventType: string | null;
  path: string | null;
  before: string | null;
  after: string | null;
  apiVersion: string | null;
  incidentId: string | null;
  integration: { id: string; name: string };
  affectedChecks: Array<{ id: string; name: string }>;
  summary: string;
  detectedAt: string;
};
type StripeChanges = { data: StripeChange[]; apiVersions: Array<{ integrationId: string; name: string; apiVersion: string | null }> };

const UPGRADE_GUIDE = 'https://docs.stripe.com/upgrades';

function KindIcon({ kind }: { kind: StripeChange['kind'] }) {
  if (kind === 'API_VERSION') return <GitCompareArrows />;
  if (kind === 'FIELD_REMOVED') return <CircleMinus />;
  return <ArrowRightLeft />;
}

function headline(change: StripeChange): string {
  if (change.kind === 'API_VERSION') return `API version ${change.before ?? '?'} → ${change.after}`;
  if (change.kind === 'FIELD_REMOVED') return `${change.path} no longer sent`;
  return `${change.path}: ${change.before} → ${change.after}`;
}

function ChangeRow({ change, linkIncident }: { change: StripeChange; linkIncident: boolean }) {
  return (
    <div className="c-list-row" style={{ alignItems: 'flex-start' }}>
      <span className="c-icon-tile"><KindIcon kind={change.kind} /></span>
      <div className="c-grow" style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <span className="c-strong" style={{ overflowWrap: 'anywhere' }}><code>{headline(change)}</code></span>
        <span className="c-muted c-small">
          {change.eventType && change.kind !== 'API_VERSION' ? `${change.eventType} · ` : ''}
          {change.integration.name} · {timeAgo(change.detectedAt)}
          {linkIncident && change.incidentId && <> · <a href={`#/incidents/${change.incidentId}`}>Incident</a></>}
        </span>
        {change.affectedChecks.length > 0 && (
          <span className="c-small">Read by {change.affectedChecks.map(check => `"${check.name}"`).join(', ')}. Your webhook handler probably reads it too.</span>
        )}
      </div>
      {change.affectedChecks.length > 0
        ? <Pill tone="bad">Used by a check</Pill>
        : change.kind === 'API_VERSION' ? <Pill tone="warn">Upgrade</Pill> : <Pill>Field change</Pill>}
    </div>
  );
}

/** Connections page: current API version per Stripe connection and recent changes. */
export function StripeChangesCard() {
  const changes = useShapi<StripeChanges>('stripe-changes?limit=20', 60_000);
  const versions = changes.data?.apiVersions ?? [];
  const list = changes.data?.data ?? [];
  if (!versions.length && !list.length) return null;

  return (
    <Card
      title="Stripe changes"
      sub="SHAPI learns every Stripe webhook's fields and tells you when the API version changes or a field your code may read disappears or changes type."
      actions={<a className="c-btn is-quiet" href={UPGRADE_GUIDE} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>Stripe upgrade notes</a>}
    >
      {versions.length > 0 && (
        <div className="c-card-body c-row" style={{ flexWrap: 'wrap', gap: 8, paddingTop: 0 }}>
          {versions.map(version => (
            <span key={version.integrationId} className="c-small c-muted">
              {version.name}: {version.apiVersion ? <code>{version.apiVersion}</code> : 'no webhook received yet'}
            </span>
          ))}
        </div>
      )}
      {list.length
        ? <div className="c-list">{list.map(change => <ChangeRow key={change.id} change={change} linkIncident />)}</div>
        : <Empty>{changes.loading && !changes.data ? 'Loading…' : 'No changes detected. Webhooks match what SHAPI has learned.'}</Empty>}
    </Card>
  );
}

/** Stripe change incidents are titled by services/stripe-changes.ts. */
export function isStripeChangeIncident(title: string): boolean {
  return /^Stripe (API version changed|changed )/.test(title);
}

/** Incident page: the changes behind a Stripe change incident (renders nothing for other incidents). */
export function IncidentStripeChanges({ incidentId }: { incidentId: string }) {
  const changes = useShapi<StripeChanges>(`stripe-changes?incidentId=${incidentId}`);
  const list = changes.data?.data ?? [];
  if (!list.length) return null;
  return (
    <Card
      title="What changed in Stripe"
      tint="peach"
      sub="Code that reads the old fields can stop provisioning customers without any error. Update your webhook handler, then mark this resolved."
      actions={<a className="c-btn is-quiet" href={UPGRADE_GUIDE} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>Stripe upgrade notes</a>}
    >
      <div className="c-list">{[...list].reverse().map(change => <ChangeRow key={change.id} change={change} linkIncident={false} />)}</div>
    </Card>
  );
}
