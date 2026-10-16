import { useShapi } from './ui';

type SystemStatus = { status: 'ok' | 'degraded'; checks: Array<{ label: string; ok: boolean; detail: string }> };

/**
 * SHAPI watches itself (apps/backend self-monitor). When its own pipeline is
 * behind, a calm "all clear" elsewhere on the page can't be trusted, so say so.
 * Renders nothing while healthy or if the status can't be loaded.
 */
export function SystemBanner() {
  const status = useShapi<SystemStatus>('system/status', 60_000);
  if (status.data?.status !== 'degraded') return null;
  const failing = status.data.checks.filter(check => !check.ok);
  return (
    <p className="c-note is-bad" role="status" style={{ margin: '0 0 16px' }}>
      <strong>SHAPI is running behind.</strong> {failing.map(check => check.detail).join(' ')} Results on this page may be out of date
      until it catches up. Your own systems are not affected.
    </p>
  );
}
