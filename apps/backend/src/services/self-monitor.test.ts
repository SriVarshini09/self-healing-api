import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  config: {
    INVARIANT_EVALUATION_INTERVAL_SEC: 60,
    SHAPI_OPERATOR_EMAIL: 'ops@example.com' as string | undefined,
    SHAPI_HEARTBEAT_URL: 'https://hc.example.test/ping/abc' as string | undefined,
  },
  prisma: {
    $queryRaw: vi.fn(),
    outcomeCheckRun: { count: vi.fn() },
    alertDelivery: { count: vi.fn() },
    webhookEvent: { count: vi.fn() },
  },
  sendEmail: vi.fn(),
  emailAvailable: vi.fn(),
}));

vi.mock('../config.js', () => ({ config: fake.config }));
vi.mock('../utils/prisma.js', () => ({ prisma: fake.prisma }));
vi.mock('./email.js', () => ({ sendEmail: fake.sendEmail, emailAvailable: fake.emailAvailable }));

const monitor = await import('./self-monitor.js');
const { renderPrometheus } = await import('../utils/metrics.js');

const T0 = new Date('2026-10-16T12:00:00Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

beforeEach(() => {
  monitor.resetSelfMonitorForTests();
  fake.prisma.$queryRaw.mockReset().mockResolvedValue([{ '?column?': 1 }]);
  fake.prisma.outcomeCheckRun.count.mockReset().mockResolvedValue(0);
  fake.prisma.alertDelivery.count.mockReset().mockResolvedValue(0);
  fake.prisma.webhookEvent.count.mockReset().mockResolvedValue(0);
  fake.sendEmail.mockReset().mockResolvedValue(undefined);
  fake.emailAvailable.mockReset().mockReturnValue(true);
  fake.config.SHAPI_OPERATOR_EMAIL = 'ops@example.com';
  fake.config.SHAPI_HEARTBEAT_URL = 'https://hc.example.test/ping/abc';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('OK')));
});

const named = (status: Awaited<ReturnType<typeof monitor.getSelfStatus>>, name: string) => status.checks.find(check => check.name === name)!;

describe('getSelfStatus', () => {
  it('is ok when ticks are recent and nothing is stuck', async () => {
    monitor.recordSchedulerTick(true, T0.getTime());
    const status = await monitor.getSelfStatus(at(1), { fresh: true });
    expect(status.status).toBe('ok');
    expect(status.checks.every(check => check.ok)).toBe(true);
  });

  it('flags a stalled scheduler after three missed intervals (at least 3 minutes)', async () => {
    monitor.recordSchedulerTick(true, T0.getTime());
    expect(named(await monitor.getSelfStatus(at(2.9), { fresh: true }), 'scheduler').ok).toBe(true);
    const stalled = await monitor.getSelfStatus(at(4), { fresh: true });
    expect(named(stalled, 'scheduler').ok).toBe(false);
    expect(stalled.status).toBe('degraded');
  });

  it('counts a tick that started but never finished cleanly as a stall too', async () => {
    monitor.recordSchedulerTick(undefined, T0.getTime());
    expect(named(await monitor.getSelfStatus(at(10), { fresh: true }), 'scheduler').ok).toBe(false);
  });

  it('flags overdue outcome runs, stuck alerts and stuck events, without exposing counts', async () => {
    monitor.recordSchedulerTick(true, T0.getTime());
    fake.prisma.outcomeCheckRun.count.mockResolvedValue(7);
    fake.prisma.alertDelivery.count.mockResolvedValue(2);
    fake.prisma.webhookEvent.count.mockResolvedValue(3);
    const status = await monitor.getSelfStatus(at(1), { fresh: true });
    expect(['outcome-runs', 'alerts', 'webhook-events'].map(name => named(status, name).ok)).toEqual([false, false, false]);
    expect(JSON.stringify(status)).not.toMatch(/\b[237]\b/);
  });

  it('reports the database down and skips the queue checks', async () => {
    monitor.recordSchedulerTick(true, T0.getTime());
    fake.prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    const status = await monitor.getSelfStatus(at(1), { fresh: true });
    expect(named(status, 'database').ok).toBe(false);
    expect(status.checks.map(check => check.name)).toEqual(['database', 'scheduler']);
    expect(JSON.stringify(status)).not.toContain('connection refused');
  });

  it('caches for a few seconds so dashboards polling do not hit the database', async () => {
    monitor.recordSchedulerTick(true, T0.getTime());
    await monitor.getSelfStatus(at(1));
    await monitor.getSelfStatus(new Date(at(1).getTime() + 5000));
    expect(fake.prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('publishes gauges for Prometheus', async () => {
    monitor.recordSchedulerTick(true, T0.getTime());
    await monitor.getSelfStatus(at(1), { fresh: true });
    const text = renderPrometheus();
    expect(text).toContain('shapi_self_check_ok{check="scheduler"} 1');
    expect(text).toContain('shapi_outcome_runs_overdue 0');
  });
});

describe('runSelfMonitorOnce', () => {
  it('pings the heartbeat only while healthy, so silence means trouble', async () => {
    monitor.recordSchedulerTick(true, T0.getTime());
    await monitor.runSelfMonitorOnce(at(1));
    expect(fetch).toHaveBeenCalledWith('https://hc.example.test/ping/abc', expect.objectContaining({ method: 'GET' }));

    vi.mocked(fetch).mockClear();
    fake.prisma.outcomeCheckRun.count.mockResolvedValue(1);
    await monitor.runSelfMonitorOnce(at(2));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('emails the operator once when something breaks, again after 6 hours, and when it recovers', async () => {
    monitor.recordSchedulerTick(true, T0.getTime());
    fake.prisma.alertDelivery.count.mockResolvedValue(1);
    await monitor.runSelfMonitorOnce(at(1));
    await monitor.runSelfMonitorOnce(at(2));
    monitor.recordSchedulerTick(true, at(29).getTime());
    await monitor.runSelfMonitorOnce(at(30));
    expect(fake.sendEmail).toHaveBeenCalledTimes(1);
    expect(fake.sendEmail.mock.calls[0][0]).toMatchObject({ to: ['ops@example.com'], subject: '[SHAPI] Alert delivery: problem detected' });

    monitor.recordSchedulerTick(true, at(6 * 60 + 1).getTime());
    await monitor.runSelfMonitorOnce(at(6 * 60 + 2));
    expect(fake.sendEmail).toHaveBeenCalledTimes(2);

    fake.prisma.alertDelivery.count.mockResolvedValue(0);
    await monitor.runSelfMonitorOnce(at(6 * 60 + 3));
    expect(fake.sendEmail).toHaveBeenCalledTimes(3);
    expect(fake.sendEmail.mock.calls[2][0].subject).toBe('[SHAPI] Alert delivery: recovered');
  });

  it('does not email when no operator address or email provider is set, and survives send failures', async () => {
    monitor.recordSchedulerTick(true, T0.getTime());
    fake.prisma.webhookEvent.count.mockResolvedValue(1);
    fake.config.SHAPI_OPERATOR_EMAIL = undefined;
    await monitor.runSelfMonitorOnce(at(1));
    expect(fake.sendEmail).not.toHaveBeenCalled();

    monitor.resetSelfMonitorForTests();
    monitor.recordSchedulerTick(true, T0.getTime());
    fake.config.SHAPI_OPERATOR_EMAIL = 'ops@example.com';
    fake.sendEmail.mockRejectedValue(new Error('resend down'));
    await expect(monitor.runSelfMonitorOnce(at(1))).resolves.toMatchObject({ status: 'degraded' });
  });

  it('survives a heartbeat URL that fails', async () => {
    monitor.recordSchedulerTick(true, T0.getTime());
    vi.mocked(fetch).mockRejectedValue(new Error('network down'));
    await expect(monitor.runSelfMonitorOnce(at(1))).resolves.toMatchObject({ status: 'ok' });
  });
});
