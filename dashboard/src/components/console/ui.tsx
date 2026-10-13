import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { fetchShapi } from '@/lib/shapi-api';

export type Tone = 'ok' | 'bad' | 'warn' | 'info' | 'neutral';
export type Tint = 'blue' | 'mint' | 'rose' | 'peach' | 'lavender' | 'teal';

export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`c-pill${tone === 'neutral' ? '' : ` is-${tone}`}`}>{children}</span>;
}

export function Card({ title, sub, actions, tint, children }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; tint?: Tint; children: ReactNode }) {
  return (
    <section className={`c-card${tint ? ` is-${tint}` : ''}`}>
      {(title || actions) && (
        <div className="c-card-head">
          <div className="c-grow">
            {title && <h2 className="c-card-title">{title}</h2>}
            {sub && <p className="c-card-sub">{sub}</p>}
          </div>
          {actions && <div className="c-row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, sub, actions, icon, tint = 'blue' }: { title: string; sub?: ReactNode; actions?: ReactNode; icon?: ReactNode; tint?: Tint }) {
  return (
    <header className="c-page-head">
      <div className="c-title-row">
        {icon && <span className={`c-page-icon is-${tint}`}>{icon}</span>}
        <div>
          <h1 className="c-page-title">{title}</h1>
          {sub && <p className="c-page-sub">{sub}</p>}
        </div>
      </div>
      {actions && <div className="c-row">{actions}</div>}
    </header>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="c-empty">{children}</p>;
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? <p className="c-note is-bad">{error}</p> : null;
}

export function severityTone(severity: string): Tone {
  return severity === 'CRITICAL' || severity === 'HIGH' ? 'bad' : severity === 'MEDIUM' ? 'warn' : 'neutral';
}

export function statusTone(status: string): Tone {
  if (status === 'RESOLVED' || status === 'REPAIRED' || status === 'PASSED' || status === 'HEALTHY' || status === 'MERGED') return 'ok';
  if (status === 'DETECTED' || status === 'FAILED' || status === 'VIOLATED') return 'bad';
  if (status === 'TRIAGED' || status === 'REPLAYING' || status === 'ERROR' || status === 'DEGRADED') return 'warn';
  return 'neutral';
}

export function label(value: string): string {
  const text = value.replaceAll('_', ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** Incident titles in plain words: "Invariant violated: Outcome: Paid customers…" -> "Paid customers…". */
export function cleanTitle(title: string): string {
  return title
    .replace(/^Invariant violated:\s*/i, '')
    .replace(/^Outcome:\s*/i, '')
    .replace(/\s+Invariant$/i, '');
}

/** "provisioning.failed" -> "Provisioning failed". */
export function humanEvent(type: string): string {
  return label(type.replace(/[._]/g, ' '));
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 90) return `${Math.round(seconds)}s`;
  if (seconds < 90 * 60) return `${Math.round(seconds / 60)} min`;
  if (seconds < 48 * 3600) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86400)} days`;
}

export function compact(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Load JSON from the API, with loading/error state and optional polling. */
export function useShapi<T>(path: string | null, refreshMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await fetchShapi<T>(path));
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError, 'Could not load data'));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void reload();
    if (!refreshMs) return;
    const timer = setInterval(() => void reload(), refreshMs);
    return () => clearInterval(timer);
  }, [reload, refreshMs]);

  return { data, error, loading, reload };
}

export async function sendJson<T>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  return fetchShapi<T>(path, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}
