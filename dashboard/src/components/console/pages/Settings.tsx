import { useEffect, useState, type FormEvent } from 'react';
import { Card, Empty, ErrorNote, PageHeader, Pill, errorMessage, label, sendJson, timeAgo, useShapi } from '../ui';
import { AlertsCard } from './AlertsCard';

type Workspace = { id: string; name: string; slug: string; createdAt: string; caller: { name: string; role: string } };
type ApiKey = {
  id: string; name: string; prefix: string; permissions: string[]; role: string;
  createdAt: string; lastUsedAt: string | null; expiresAt: string | null;
};

export function SettingsPage() {
  const workspace = useShapi<Workspace>('workspace');
  const canManage = workspace.data ? ['OWNER', 'ADMIN'].includes(workspace.data.caller.role) : false;

  return (
    <div className="c-page">
      <PageHeader title="Settings" sub="Your workspace, where alerts go, and API keys for automation." />
      <ErrorNote error={workspace.error} />
      {workspace.data && <WorkspaceCard workspace={workspace.data} canManage={canManage} onSaved={() => void workspace.reload()} />}
      {workspace.data && <AlertsCard canEdit={workspace.data.caller.role !== 'VIEWER'} />}
      {workspace.data && (canManage
        ? <ApiKeysCard />
        : <Card title="API keys"><Empty>Only an Owner or Admin can manage API keys.</Empty></Card>)}
    </div>
  );
}

function WorkspaceCard({ workspace, canManage, onSaved }: { workspace: Workspace; canManage: boolean; onSaved: () => void }) {
  const [name, setName] = useState(workspace.name);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  useEffect(() => setName(workspace.name), [workspace.name]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await sendJson('workspace', 'PATCH', { name });
      setMessage({ tone: 'ok', text: 'Workspace renamed.' });
      onSaved();
    } catch (error) {
      setMessage({ tone: 'bad', text: errorMessage(error, 'Could not rename the workspace') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Workspace">
      <form className="c-card-body c-form" onSubmit={event => void save(event)}>
        <label className="c-field">
          <span className="c-label">Workspace name</span>
          <input className="c-input" value={name} onChange={event => setName(event.target.value)} disabled={!canManage} minLength={2} maxLength={80} required />
        </label>
        <div className="c-field">
          <span className="c-label">You</span>
          <div className="c-row" style={{ minHeight: 38 }}>
            <span>{workspace.caller.name}</span>
            <Pill tone="info">{label(workspace.caller.role)}</Pill>
          </div>
        </div>
        <div className="c-row c-span-2">
          {canManage && <button className="c-btn is-primary" type="submit" disabled={busy || name.trim() === workspace.name}>{busy ? 'Saving…' : 'Save'}</button>}
          <span className="c-hint">Created {timeAgo(workspace.createdAt)} · ID <code>{workspace.slug}</code></span>
        </div>
        {message && <p className={`c-note is-${message.tone} c-span-2`}>{message.text}</p>}
      </form>
    </Card>
  );
}

function ApiKeysCard() {
  const keys = useShapi<ApiKey[]>('api-keys');
  const [name, setName] = useState('');
  const [access, setAccess] = useState<'read' | 'write'>('write');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const result = await sendJson<{ key: string }>('api-keys', 'POST', {
        name: name.trim(),
        permissions: access === 'write' ? ['read', 'write'] : ['read'],
        role: access === 'write' ? 'OPERATOR' : 'VIEWER',
      });
      setCreated(result.key);
      setName('');
      void keys.reload();
    } catch (createError) {
      setError(errorMessage(createError, 'Could not create the key'));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await sendJson(`api-keys/${id}`, 'DELETE');
      setConfirming(null);
      void keys.reload();
    } catch (revokeError) {
      setError(errorMessage(revokeError, 'Could not revoke the key'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card title="API keys" sub="For scripts, CI and the SHAPI SDK. The dashboard itself doesn't need one.">
      <form className="c-card-body c-row" onSubmit={event => void create(event)} style={{ alignItems: 'flex-end' }}>
        <label className="c-field c-grow">
          <span className="c-label">Key name</span>
          <input className="c-input" placeholder="e.g. Production SDK" value={name} onChange={event => setName(event.target.value)} required maxLength={200} />
        </label>
        <label className="c-field">
          <span className="c-label">Access</span>
          <select className="c-select" value={access} onChange={event => setAccess(event.target.value as 'read' | 'write')}>
            <option value="write">Read and write</option>
            <option value="read">Read only</option>
          </select>
        </label>
        <button className="c-btn is-primary" type="submit" disabled={busy || !name.trim()}>Create key</button>
      </form>
      {created && (
        <div className="c-card-body" style={{ paddingTop: 0 }}>
          <div className="c-note is-ok" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="c-strong">Copy this key now. SHAPI won't show it again.</span>
            <div className="c-row">
              <code className="c-grow" style={{ wordBreak: 'break-all' }}>{created}</code>
              <button className="c-btn" type="button" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</button>
              <button className="c-btn is-quiet" type="button" onClick={() => setCreated(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
      {error && <div className="c-card-body" style={{ paddingTop: 0 }}><p className="c-note is-bad">{error}</p></div>}
      {keys.data?.length ? (
        <div className="c-table-wrap">
          <table className="c-table">
            <thead><tr><th>Name</th><th>Key</th><th>Access</th><th>Last used</th><th>Created</th><th /></tr></thead>
            <tbody>
              {keys.data.map(key => (
                <tr key={key.id}>
                  <td className="c-strong">{key.name}</td>
                  <td><code>{key.prefix}…</code></td>
                  <td><Pill tone={key.permissions.includes('write') ? 'info' : 'neutral'}>{key.permissions.includes('write') ? 'Read and write' : 'Read only'}</Pill></td>
                  <td className="c-muted c-small">{key.lastUsedAt ? timeAgo(key.lastUsedAt) : 'never'}</td>
                  <td className="c-muted c-small">{timeAgo(key.createdAt)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {confirming === key.id ? (
                      <span className="c-row" style={{ justifyContent: 'flex-end' }}>
                        <button className="c-btn is-danger" onClick={() => void revoke(key.id)} disabled={busy}>Revoke</button>
                        <button className="c-btn is-quiet" onClick={() => setConfirming(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button className="c-btn is-quiet" onClick={() => setConfirming(key.id)}>Revoke</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>{keys.loading && !keys.data ? 'Loading…' : 'No API keys yet.'}</Empty>
      )}
    </Card>
  );
}
