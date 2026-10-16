import { useState, type FormEvent } from 'react';
import { Card, Empty, Pill, errorMessage, label, sendJson, timeAgo, useShapi } from '../ui';

type Role = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER';
type Member = { id: string; name: string | null; email: string; role: Role; sso: boolean; you: boolean; createdAt: string };
type Invite = { id: string; email: string; role: Role; expiresAt: string; createdAt: string; invitedBy: string | null };
type Team = { members: Member[]; invites: Invite[]; canManage: boolean; emailAvailable: boolean };

const ROLE_HELP: Record<Exclude<Role, 'OWNER'>, string> = {
  ADMIN: 'Everything, including the team and API keys',
  OPERATOR: 'Set up checks, connections and alerts; handle incidents',
  VIEWER: 'Read only',
};

export function TeamCard() {
  const team = useShapi<Team>('workspace/members');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Exclude<Role, 'OWNER'>>('OPERATOR');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ email: string; link: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = team.data;

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      void team.reload();
    } catch (actionError) {
      setError(errorMessage(actionError, 'Request failed'));
    } finally {
      setBusy(false);
    }
  };

  const invite = (event: FormEvent) => {
    event.preventDefault();
    setCopied(false);
    void run(async () => {
      const result = await sendJson<{ link: string; emailed: boolean; invite: { email: string } }>('workspace/invites', 'POST', { email: email.trim(), role });
      setCreated({ email: result.invite.email, link: result.link, emailed: result.emailed });
      setEmail('');
    });
  };
  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card title="Team" sub="Invite your cofounder or team so everyone sees incidents. Roles decide what each person can change.">
      {data?.canManage && (
        <form className="c-card-body c-row" onSubmit={invite} style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className="c-field c-grow" style={{ minWidth: 220 }}>
            <span className="c-label">Email</span>
            <input className="c-input" type="email" required maxLength={200} placeholder="cofounder@company.com" value={email} onChange={event => setEmail(event.target.value)} />
          </label>
          <label className="c-field">
            <span className="c-label">Role</span>
            <select className="c-select" value={role} onChange={event => setRole(event.target.value as Exclude<Role, 'OWNER'>)}>
              <option value="ADMIN">Admin</option>
              <option value="OPERATOR">Operator</option>
              <option value="VIEWER">Viewer</option>
            </select>
          </label>
          <button className="c-btn is-primary" type="submit" disabled={busy || !email.trim()}>Invite</button>
          <span className="c-hint" style={{ flexBasis: '100%' }}>{label(role)}: {ROLE_HELP[role]}.</span>
        </form>
      )}
      {created && (
        <div className="c-card-body" style={{ paddingTop: 0 }}>
          <div className="c-note is-ok" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="c-strong">
              {created.emailed ? `Invite emailed to ${created.email}.` : `Send this link to ${created.email}.`} It works once, within 7 days.
            </span>
            <div className="c-row">
              <code className="c-grow" style={{ wordBreak: 'break-all' }}>{created.link}</code>
              <button className="c-btn" type="button" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy link'}</button>
              <button className="c-btn is-quiet" type="button" onClick={() => setCreated(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
      {error && <div className="c-card-body" style={{ paddingTop: 0 }}><p className="c-note is-bad">{error}</p></div>}

      {data ? (
        <div className="c-table-wrap">
          <table className="c-table">
            <thead><tr><th>Person</th><th>Role</th><th>Joined</th><th /></tr></thead>
            <tbody>
              {data.members.map(member => (
                <tr key={member.id}>
                  <td>
                    <div className="c-strong">{member.name ?? member.email}{member.you ? ' (you)' : ''}</div>
                    <div className="c-muted c-small">{member.email}{member.sso ? ' · SSO' : ''}</div>
                  </td>
                  <td>
                    {data.canManage && !member.you && member.role !== 'OWNER' ? (
                      <select className="c-select" style={{ width: 'auto' }} value={member.role} disabled={busy} aria-label={`Role for ${member.email}`}
                        onChange={event => void run(() => sendJson(`workspace/members/${member.id}`, 'PATCH', { role: event.target.value }))}>
                        <option value="ADMIN">Admin</option>
                        <option value="OPERATOR">Operator</option>
                        <option value="VIEWER">Viewer</option>
                      </select>
                    ) : (
                      <Pill tone={member.role === 'OWNER' ? 'info' : 'neutral'}>{label(member.role)}</Pill>
                    )}
                  </td>
                  <td className="c-muted c-small">{timeAgo(member.createdAt)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {data.canManage && !member.you && member.role !== 'OWNER' && (confirming === member.id ? (
                      <span className="c-row" style={{ justifyContent: 'flex-end' }}>
                        <button className="c-btn is-danger" disabled={busy} onClick={() => void run(async () => { await sendJson(`workspace/members/${member.id}`, 'DELETE'); setConfirming(null); })}>Remove</button>
                        <button className="c-btn is-quiet" onClick={() => setConfirming(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button className="c-btn is-quiet" onClick={() => setConfirming(member.id)}>Remove</button>
                    ))}
                  </td>
                </tr>
              ))}
              {!data.members.length && !data.invites.length && (
                <tr><td colSpan={4} className="c-muted">No people in this workspace yet. It is being used with an API key.</td></tr>
              )}
              {data.invites.map(pending => (
                <tr key={pending.id}>
                  <td>
                    <div className="c-strong">{pending.email}</div>
                    <div className="c-muted c-small">Invited{pending.invitedBy ? ` by ${pending.invitedBy}` : ''} · link expires {new Date(pending.expiresAt).toLocaleDateString()}</div>
                  </td>
                  <td><Pill tone="warn">{label(pending.role)} · pending</Pill></td>
                  <td className="c-muted c-small">{timeAgo(pending.createdAt)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {data.canManage && (
                      <button className="c-btn is-quiet" disabled={busy} onClick={() => void run(() => sendJson(`workspace/invites/${pending.id}`, 'DELETE'))}>Revoke</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>{team.error ?? 'Loading…'}</Empty>
      )}
    </Card>
  );
}
