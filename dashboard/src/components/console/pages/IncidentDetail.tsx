import { useState } from 'react';
import { fetchShapi } from '@/lib/shapi-api';
import { Card, Empty, ErrorNote, Pill, cleanTitle, errorMessage, label, sendJson, severityTone, statusTone, timeAgo, useShapi } from '../ui';
import {
  OPEN_STATUSES,
  type GitHubInstallation,
  type GitHubPr,
  type IncidentDetail,
  type RepairCandidate,
  type RepairPreview,
  type TimelineItem,
} from '../types';

export function IncidentDetailPage({ id, go }: { id: string; go: (route: string) => void }) {
  const detail = useShapi<IncidentDetail>(`incidents/${id}`);
  const timeline = useShapi<{ timeline: TimelineItem[] }>(`incidents/${id}/timeline`);
  const installations = useShapi<GitHubInstallation[]>('github/installations');
  const prs = useShapi<GitHubPr[]>(`github/incidents/${id}/prs`);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad' | 'info'; text: string } | null>(null);

  const incident = detail.data;
  const run = async (key: string, work: () => Promise<string | void>) => {
    setBusy(key);
    setMessage(null);
    try {
      const text = await work();
      if (text) setMessage({ tone: 'ok', text });
    } catch (error) {
      setMessage({ tone: 'bad', text: errorMessage(error, 'Request failed') });
    } finally {
      setBusy(null);
    }
  };

  const diagnose = () => run('diagnose', async () => {
    await sendJson(`incidents/${id}/diagnose`, 'POST');
    await Promise.all([detail.reload(), timeline.reload()]);
    return 'Diagnosis complete.';
  });

  const setStatus = (status: 'RESOLVED' | 'DISMISSED') => run(status, async () => {
    await sendJson(`incidents/${id}`, 'PATCH', { status });
    await Promise.all([detail.reload(), timeline.reload()]);
    return status === 'RESOLVED' ? 'Marked as resolved.' : 'Dismissed.';
  });

  if (detail.error) {
    return (
      <div className="c-page">
        <a className="c-back" href="#/incidents" onClick={() => go('incidents')}>← Incidents</a>
        <ErrorNote error={detail.error} />
      </div>
    );
  }
  if (!incident) return <div className="c-page"><Empty>Loading incident…</Empty></div>;

  const isOpen = OPEN_STATUSES.includes(incident.status);
  const diagnosed = incident.status !== 'DETECTED' && Boolean(incident.rootCause);

  return (
    <div className="c-page">
      <a className="c-back" href="#/incidents" onClick={() => go('incidents')}>← Incidents</a>
      <header className="c-page-head">
        <div className="c-grow">
          <div className="c-row" style={{ marginBottom: 6 }}>
            <Pill tone={severityTone(incident.severity)}>{incident.severity.toLowerCase()}</Pill>
            <Pill tone={statusTone(incident.status)}>{label(incident.status)}</Pill>
            <span className="c-muted c-small">{incident.integration?.name} · detected {timeAgo(incident.detectedAt)}</span>
          </div>
          <h1 className="c-page-title">{cleanTitle(incident.invariant?.name ?? incident.title)}</h1>
          {incident.description && <p className="c-page-sub">{incident.description}</p>}
        </div>
        {isOpen && (
          <div className="c-row">
            <button className="c-btn" onClick={() => void setStatus('DISMISSED')} disabled={Boolean(busy)}>Dismiss</button>
            <button className="c-btn is-primary" onClick={() => void setStatus('RESOLVED')} disabled={Boolean(busy)}>Mark resolved</button>
          </div>
        )}
      </header>

      {message && <p className={`c-note is-${message.tone === 'info' ? 'warn' : message.tone}`}>{message.text}</p>}

      <Card
        title="What happened"
        actions={incident.status === 'DETECTED' && (
          <button className="c-btn is-primary" onClick={() => void diagnose()} disabled={busy === 'diagnose'}>
            {busy === 'diagnose' ? 'Diagnosing…' : 'Run diagnosis'}
          </button>
        )}
      >
        <div className="c-card-body">
          {diagnosed ? (
            <dl className="c-dl">
              <dt>Root cause</dt><dd>{incident.rootCause}</dd>
              <dt>Suggested fix</dt><dd>{incident.suggestedFix ?? '—'}</dd>
              {incident.invariant && <><dt>Rule</dt><dd>{incident.invariant.name}</dd></>}
            </dl>
          ) : (
            <p className="c-muted" style={{ margin: 0 }}>
              Not diagnosed yet. Diagnosis looks at the failing events and suggests where to look and what to change.
            </p>
          )}
        </div>
      </Card>

      {(incident.repairCandidates?.length ?? 0) > 0 && (
        <Card title="Proposed repairs" sub="Every repair is reviewed by a person before a pull request is opened.">
          <div className="c-list">
            {incident.repairCandidates!.map(candidate => (
              <RepairCandidateRow
                key={candidate.id}
                incidentId={id}
                candidate={candidate}
                installations={installations.data ?? []}
                body={incident.suggestedFix ?? candidate.description}
                onCreated={() => void prs.reload()}
              />
            ))}
          </div>
        </Card>
      )}

      {(prs.data?.length ?? 0) > 0 && (
        <Card title="Pull requests">
          <div className="c-list">
            {prs.data!.map(pr => <PullRequestRow key={pr.id} pr={pr} onChanged={() => void prs.reload()} />)}
          </div>
        </Card>
      )}

      <Card title="Timeline">
        <div className="c-card-body">
          {timeline.data?.timeline.length ? (
            <ul className="c-timeline">
              {timeline.data.timeline.map((item, index) => (
                <li key={`${item.timestamp}-${index}`}>
                  <span className="c-muted c-small">{new Date(item.timestamp).toLocaleString()}</span>
                  <span>{item.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="c-muted" style={{ margin: 0 }}>{timeline.loading ? 'Loading…' : 'No events yet.'}</p>
          )}
        </div>
      </Card>

      <ReplayBox incidentId={id} integrationId={incident.integrationId} />
    </div>
  );
}

function RepairCandidateRow({
  incidentId, candidate, installations, body, onCreated,
}: {
  incidentId: string;
  candidate: RepairCandidate;
  installations: GitHubInstallation[];
  body: string;
  onCreated: () => void;
}) {
  const [showDiff, setShowDiff] = useState(false);
  const [preview, setPreview] = useState<RepairPreview | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const installation = installations.find(item => candidate.repository && item.repositories.includes(candidate.repository));
  const applicable = Boolean(candidate.repository && Array.isArray(candidate.changes) && candidate.changes.length);
  const blocker = !applicable
    ? 'Needs manual review: no applicable patch for a mapped repository.'
    : !installation
      ? `Connect the GitHub App to ${candidate.repository} to preview this patch.`
      : null;

  const doPreview = async () => {
    if (!installation || !candidate.repository) return;
    setBusy(true);
    setNote(null);
    try {
      setPreview(await sendJson<RepairPreview>(`github/incidents/${incidentId}/pr/preview`, 'POST', {
        installationId: installation.id, repository: candidate.repository, candidateId: candidate.id,
      }));
      setReviewed(false);
    } catch (error) {
      setNote({ tone: 'bad', text: errorMessage(error, 'Preview failed') });
    } finally {
      setBusy(false);
    }
  };

  const createPr = async () => {
    if (!installation || !candidate.repository || !preview) return;
    setBusy(true);
    setNote(null);
    try {
      const pr = await sendJson<GitHubPr>(`github/incidents/${incidentId}/pr`, 'POST', {
        installationId: installation.id,
        repository: candidate.repository,
        candidateId: candidate.id,
        previewToken: preview.previewToken,
        title: `SHAPI repair: ${candidate.description}`,
        body,
      });
      setNote({ tone: 'ok', text: `Pull request #${pr.prNumber} opened.` });
      setPreview(null);
      onCreated();
    } catch (error) {
      setNote({ tone: 'bad', text: errorMessage(error, 'Could not open the pull request') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="c-row">
        <span className="c-grow c-strong">{candidate.description}</span>
        <Pill tone="info">{Math.round(candidate.confidence * 100)}% confidence</Pill>
        <Pill tone={candidate.reviewStatus === 'PR_READY_AFTER_REVIEW' ? 'ok' : 'warn'}>
          {candidate.reviewStatus === 'PR_READY_AFTER_REVIEW' ? 'Ready after review' : 'Manual review'}
        </Pill>
      </div>
      <p className="c-muted c-small" style={{ margin: 0 }}>
        {candidate.repository ? `${candidate.repository} · ` : ''}{candidate.files.join(', ') || 'no files'}
        {candidate.reviewReason ? ` · ${candidate.reviewReason}` : ''}
      </p>
      <div className="c-row">
        {candidate.diff && <button className="c-btn" onClick={() => setShowDiff(value => !value)}>{showDiff ? 'Hide change' : 'Show change'}</button>}
        {!blocker && <button className="c-btn" onClick={() => void doPreview()} disabled={busy}>{busy && !preview ? 'Previewing…' : 'Preview patch'}</button>}
        {blocker && <span className="c-muted c-small">{blocker}</span>}
      </div>
      {showDiff && candidate.diff && <pre className="c-pre">{candidate.diff}</pre>}
      {preview && (
        <div className="c-note" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span>Patch against <code>{preview.repository}@{preview.base}</code> ({preview.baseSha.slice(0, 8)}), {preview.changes.length} file{preview.changes.length === 1 ? '' : 's'}:</span>
          {preview.changes.map(change => (
            <div key={change.path}>
              <div className="c-strong c-small">{change.path} <span className="c-muted">({change.kind})</span></div>
              {change.before && <pre className="c-pre" style={{ marginTop: 6 }}>{change.before.text}</pre>}
              <pre className="c-pre" style={{ marginTop: 6, background: 'var(--c-ok-soft)' }}>{change.after.text}</pre>
            </div>
          ))}
          <label className="c-row c-small"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> I reviewed this patch</label>
          <div><button className="c-btn is-primary" onClick={() => void createPr()} disabled={!reviewed || busy}>Open pull request</button></div>
        </div>
      )}
      {note && <p className={`c-note is-${note.tone}`}>{note.text}</p>}
    </div>
  );
}

function PullRequestRow({ pr, onChanged }: { pr: GitHubPr; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const verify = async () => {
    setBusy(true);
    setNote(null);
    try {
      const result = await sendJson<{ verified: boolean; ciPassed: boolean; merged: boolean; closed: boolean }>(`github/prs/${pr.id}/verify`, 'POST');
      setNote(result.merged ? 'Merged.' : result.closed ? 'Closed.' : result.ciPassed ? 'CI passed.' : 'CI still running or failing.');
      onChanged();
    } catch (error) {
      setNote(errorMessage(error, 'Verification failed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="c-list-row">
      <a href={pr.prUrl} target="_blank" rel="noreferrer" className="c-strong">#{pr.prNumber}</a>
      <span className="c-grow c-truncate">{pr.title} <span className="c-muted c-small">· {pr.repository}</span></span>
      <Pill tone={statusTone(pr.status)}>{label(pr.status)}</Pill>
      {pr.verified && <Pill tone="ok">Verified</Pill>}
      {note && <span className="c-muted c-small">{note}</span>}
      <button className="c-btn" onClick={() => void verify()} disabled={busy}>{busy ? 'Checking…' : 'Check CI'}</button>
    </div>
  );
}

function ReplayBox({ incidentId, integrationId }: { incidentId: string; integrationId: string }) {
  const [open, setOpen] = useState(false);
  const [candidate, setCandidate] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const replay = async () => {
    setBusy(true);
    setNote(null);
    try {
      const events = await fetchShapi<{ data: Array<{ id: string }> }>(`integrations/${integrationId}/webhook-events?pageSize=1&status=COMPLETED`);
      const event = events.data?.[0];
      if (!event) throw new Error('No completed webhook event is available to replay.');
      const job = await sendJson<{ status: string; result?: string | null }>(`incidents/${incidentId}/replay`, 'POST', { webhookEventId: event.id, fixCandidate: candidate.trim() });
      setNote(`Replay ${job.status.toLowerCase()}${job.result ? `: ${job.result.toLowerCase()}` : ''}.`);
    } catch (error) {
      setNote(errorMessage(error, 'Replay failed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Replay a fix (advanced)" actions={<button className="c-btn is-quiet" onClick={() => setOpen(value => !value)}>{open ? 'Hide' : 'Show'}</button>}>
      {open && (
        <div className="c-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p className="c-muted c-small" style={{ margin: 0 }}>Re-run the latest webhook event with a field change, e.g. <code>add_field:status:"paid"</code>.</p>
          <div className="c-row">
            <input className="c-input c-grow" value={candidate} onChange={event => setCandidate(event.target.value)} placeholder='add_field:status:"paid"' />
            <button className="c-btn" onClick={() => void replay()} disabled={busy || !candidate.trim()}>{busy ? 'Replaying…' : 'Replay'}</button>
          </div>
          {note && <p className="c-note">{note}</p>}
        </div>
      )}
    </Card>
  );
}
