import { useState } from 'react';
import { ScrollText } from 'lucide-react';
import { Card, Empty, ErrorNote, PageHeader, Pill, errorMessage, label, sendJson, statusTone, useShapi } from '../ui';
import type { Invariant } from '../types';

export function RulesPage() {
  const rules = useShapi<{ data: Invariant[] }>('invariants?pageSize=100');
  const list = rules.data?.data ?? [];
  return (
    <div className="c-page">
      <PageHeader
        title="Rules"
        icon={<ScrollText />}
        tint="lavender"
        sub="The behavior SHAPI expects from each integration, and where a reviewed repair may be proposed when one breaks."
        actions={<button className="c-btn" onClick={() => void rules.reload()}>Refresh</button>}
      />
      <ErrorNote error={rules.error} />
      <Card>
        {list.length ? (
          <div className="c-list">{list.map(rule => <RuleRow key={rule.id} rule={rule} onSaved={() => void rules.reload()} />)}</div>
        ) : (
          <Empty>{rules.loading && !rules.data ? 'Loading…' : 'No rules yet.'}</Empty>
        )}
      </Card>
    </div>
  );
}

function readinessTone(state?: string) {
  if (state === 'READY_FOR_TARGET_REVIEW') return 'ok' as const;
  if (state?.startsWith('BLOCKED')) return 'bad' as const;
  return 'warn' as const;
}

function RuleRow({ rule, onSaved }: { rule: Invariant; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [repository, setRepository] = useState(rule.repairRepository ?? '');
  const [filePath, setFilePath] = useState(rule.repairFilePath ?? '');
  const [checks, setChecks] = useState(rule.repairRequiredChecks.join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (Boolean(repository.trim()) !== Boolean(filePath.trim())) {
      setError('Set repository and file path together, or clear both.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendJson(`invariants/${rule.id}`, 'PATCH', {
        repairRepository: repository.trim() || null,
        repairFilePath: filePath.trim() || null,
        repairRequiredChecks: checks.split(/[\r\n,]+/).map(item => item.trim()).filter(Boolean),
      });
      setEditing(false);
      onSaved();
    } catch (saveError) {
      setError(errorMessage(saveError, 'Could not save'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="c-row">
        <span className="c-grow c-strong">{rule.name}</span>
        <span className="c-muted c-small">{rule.integration?.name}</span>
        <Pill tone={statusTone(rule.status)}>{label(rule.status)}</Pill>
      </div>
      {rule.predicateDescription && <span className="c-muted c-small">{rule.predicateDescription}</span>}
      <div className="c-row c-small">
        <span className="c-muted">Repair target:</span>
        {rule.repairRepository ? <code>{rule.repairRepository} / {rule.repairFilePath}</code> : <span className="c-muted">not set</span>}
        {rule.repairReadiness && <Pill tone={readinessTone(rule.repairReadiness.state)}>{label(rule.repairReadiness.state)}</Pill>}
        <button className="c-btn is-quiet" onClick={() => setEditing(value => !value)}>{editing ? 'Cancel' : 'Edit'}</button>
      </div>
      {rule.repairReadiness?.reason && <span className="c-muted c-small">{rule.repairReadiness.reason}</span>}
      {editing && (
        <div className="c-form" style={{ marginTop: 4 }}>
          <label className="c-field">
            <span className="c-label">GitHub repository</span>
            <input className="c-input" placeholder="owner/repository" value={repository} onChange={event => setRepository(event.target.value)} />
          </label>
          <label className="c-field">
            <span className="c-label">File a repair may change</span>
            <input className="c-input" placeholder="src/billing/webhook.ts" value={filePath} onChange={event => setFilePath(event.target.value)} />
          </label>
          <label className="c-field c-span-2">
            <span className="c-label">CI checks that must pass</span>
            <input className="c-input" placeholder="test, lint" value={checks} onChange={event => setChecks(event.target.value)} />
          </label>
          {error && <p className="c-note is-bad c-span-2">{error}</p>}
          <div className="c-span-2"><button className="c-btn is-primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
        </div>
      )}
    </div>
  );
}
