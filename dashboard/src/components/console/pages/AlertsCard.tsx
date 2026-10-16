import { useState, type FormEvent } from 'react';
import { Hash, Mail } from 'lucide-react';
import { Card, Empty, Pill, errorMessage, sendJson, timeAgo, useShapi } from '../ui';

type AlertDestination = {
  id: string;
  kind: 'SLACK' | 'EMAIL';
  name: string;
  emails: string[];
  enabled: boolean;
  notifyResolved: boolean;
  slackConfigured: boolean;
  lastDeliveredAt: string | null;
  lastError: string | null;
};

export function AlertsCard({ canEdit }: { canEdit: boolean }) {
  const destinations = useShapi<{ data: AlertDestination[]; emailAvailable: boolean }>('alerts/destinations');
  const [adding, setAdding] = useState(false);
  const list = destinations.data?.data ?? [];

  return (
    <Card
      title="Alerts"
      sub="Get told the moment a paying customer doesn't get access, and again when it's resolved."
      actions={canEdit ? <button className="c-btn is-primary" onClick={() => setAdding(value => !value)}>{adding ? 'Cancel' : 'Add destination'}</button> : undefined}
    >
      {adding && (
        <AddDestination
          emailAvailable={destinations.data?.emailAvailable ?? false}
          onCreated={() => { setAdding(false); void destinations.reload(); }}
        />
      )}
      {list.length ? (
        <div className="c-list">
          {list.map(destination => (
            <DestinationRow key={destination.id} destination={destination} canEdit={canEdit} onChanged={() => void destinations.reload()} />
          ))}
        </div>
      ) : (
        <Empty>{destinations.loading && !destinations.data ? 'Loading…' : 'No alert destinations yet. Add Slack or email so incidents reach you.'}</Empty>
      )}
    </Card>
  );
}

function AddDestination({ emailAvailable, onCreated }: { emailAvailable: boolean; onCreated: () => void }) {
  const [kind, setKind] = useState<'SLACK' | 'EMAIL'>('SLACK');
  const [name, setName] = useState('#payments-alerts');
  const [slackWebhookUrl, setSlackWebhookUrl] = useState('');
  const [emails, setEmails] = useState('');
  const [notifyResolved, setNotifyResolved] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sendJson('alerts/destinations', 'POST', kind === 'SLACK'
        ? { kind, name: name.trim(), slackWebhookUrl: slackWebhookUrl.trim(), notifyResolved }
        : { kind, name: name.trim(), emails: emails.split(/[\s,;]+/).filter(Boolean), notifyResolved });
      setSlackWebhookUrl('');
      onCreated();
    } catch (createError) {
      setError(errorMessage(createError, 'Could not add the destination'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="c-card-body c-form" onSubmit={event => void submit(event)} style={{ borderBottom: '1px solid var(--c-line)' }}>
      <div className="c-field c-span-2">
        <span className="c-label">Send alerts to</span>
        <div className="c-seg" role="tablist" aria-label="Destination type" style={{ maxWidth: 320 }}>
          <button type="button" role="tab" aria-selected={kind === 'SLACK'} onClick={() => { setKind('SLACK'); setName('#payments-alerts'); }}>Slack</button>
          <button type="button" role="tab" aria-selected={kind === 'EMAIL'} onClick={() => { setKind('EMAIL'); setName('Founders'); }}>Email</button>
        </div>
      </div>
      <label className="c-field">
        <span className="c-label">Name</span>
        <input className="c-input" value={name} onChange={event => setName(event.target.value)} required maxLength={80} />
      </label>
      {kind === 'SLACK' ? (
        <label className="c-field">
          <span className="c-label">Slack incoming webhook URL</span>
          <input
            className="c-input"
            type="password"
            autoComplete="off"
            placeholder="https://hooks.slack.com/services/…"
            value={slackWebhookUrl}
            onChange={event => setSlackWebhookUrl(event.target.value)}
            required
          />
          <span className="c-hint">
            In Slack, create an app with Incoming Webhooks and pick a channel (
            <a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noreferrer">how</a>
            ). Saved encrypted, never shown again.
          </span>
        </label>
      ) : (
        <label className="c-field">
          <span className="c-label">Email addresses</span>
          <input
            className="c-input"
            placeholder="you@company.com, cofounder@company.com"
            value={emails}
            onChange={event => setEmails(event.target.value)}
            required
            disabled={!emailAvailable}
          />
          {!emailAvailable && (
            <span className="c-hint">Email alerts aren't switched on for this SHAPI workspace yet. Use Slack for now.</span>
          )}
        </label>
      )}
      <label className="c-row c-span-2 c-small">
        <input type="checkbox" checked={notifyResolved} onChange={event => setNotifyResolved(event.target.checked)} />
        Also send a message when the incident is resolved
      </label>
      {error && <p className="c-note is-bad c-span-2">{error}</p>}
      <div className="c-span-2">
        <button className="c-btn is-primary" type="submit" disabled={busy || (kind === 'EMAIL' && !emailAvailable)}>{busy ? 'Saving…' : 'Save destination'}</button>
      </div>
    </form>
  );
}

function DestinationRow({ destination, canEdit, onChanged }: { destination: AlertDestination; canEdit: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const act = async (work: () => Promise<string | void>) => {
    setBusy(true);
    setNote(null);
    try {
      const text = await work();
      if (text) setNote({ tone: 'ok', text });
    } catch (actionError) {
      setNote({ tone: 'bad', text: errorMessage(actionError, 'Request failed') });
    } finally {
      setBusy(false);
    }
  };

  const test = () => act(async () => {
    await sendJson(`alerts/destinations/${destination.id}/test`, 'POST');
    onChanged();
    return destination.kind === 'SLACK' ? 'Test message sent. Check the Slack channel.' : 'Test email sent.';
  });
  const toggle = (field: 'enabled' | 'notifyResolved') => act(async () => {
    await sendJson(`alerts/destinations/${destination.id}`, 'PATCH', { [field]: !destination[field] });
    onChanged();
  });
  const remove = () => act(async () => {
    await sendJson(`alerts/destinations/${destination.id}`, 'DELETE');
    onChanged();
  });

  return (
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="c-row">
        <span className="c-icon-tile">{destination.kind === 'SLACK' ? <Hash /> : <Mail />}</span>
        <div className="c-grow">
          <div className="c-strong">{destination.name}</div>
          <div className="c-muted c-small c-truncate">
            {destination.kind === 'SLACK' ? 'Slack' : destination.emails.join(', ')}
            {' · '}
            {destination.lastDeliveredAt ? `last sent ${timeAgo(destination.lastDeliveredAt)}` : 'nothing sent yet'}
            {destination.notifyResolved ? ' · resolved messages on' : ''}
          </div>
        </div>
        <Pill tone={destination.enabled ? (destination.lastError ? 'warn' : 'ok') : 'neutral'}>
          {destination.enabled ? (destination.lastError ? 'Failing' : 'Active') : 'Paused'}
        </Pill>
        {canEdit && (
          <>
            <button className="c-btn" onClick={() => void test()} disabled={busy}>Send test</button>
            <button className="c-btn" onClick={() => void toggle('enabled')} disabled={busy}>{destination.enabled ? 'Pause' : 'Resume'}</button>
            <button className="c-btn is-quiet" onClick={() => void toggle('notifyResolved')} disabled={busy}>
              {destination.notifyResolved ? 'Resolved: on' : 'Resolved: off'}
            </button>
            {confirming ? (
              <>
                <button className="c-btn is-danger" onClick={() => void remove()} disabled={busy}>Delete</button>
                <button className="c-btn is-quiet" onClick={() => setConfirming(false)}>Cancel</button>
              </>
            ) : (
              <button className="c-btn is-quiet" onClick={() => setConfirming(true)}>Delete</button>
            )}
          </>
        )}
      </div>
      {destination.lastError && <p className="c-note is-warn">Last error: {destination.lastError}</p>}
      {note && <p className={`c-note is-${note.tone}`}>{note.text}</p>}
    </div>
  );
}
