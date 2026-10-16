import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  prisma: { invariant: { findMany: vi.fn() } },
  evaluateInvariantWindow: vi.fn(),
  checkDrift: vi.fn(),
}));

vi.mock('../utils/prisma.js', () => ({ prisma: fake.prisma }));
vi.mock('../routes/webhooks.js', () => ({ checkDrift: fake.checkDrift, recoverPendingWebhookEvents: vi.fn() }));
vi.mock('./invariants.js', () => ({ evaluateInvariantWindow: fake.evaluateInvariantWindow }));
vi.mock('./alerts.js', () => ({ deliverPendingAlerts: vi.fn() }));
vi.mock('./outcome-checks.js', () => ({ processDueOutcomeRuns: vi.fn(), reconcileDueStripeChecks: vi.fn() }));
vi.mock('./self-monitor.js', () => ({ recordSchedulerTick: vi.fn() }));
vi.mock('./retention.js', () => ({ purgeIfDue: vi.fn() }));

const { evaluateAllInvariantWindows } = await import('./scheduler.js');

const rule = (id: string) => ({ id, evaluationWindowSec: 300 });

describe('evaluateAllInvariantWindows', () => {
  beforeEach(() => {
    fake.prisma.invariant.findMany.mockReset();
    fake.evaluateInvariantWindow.mockReset();
    fake.checkDrift.mockReset();
  });

  it('keeps evaluating the other rules when one throws', async () => {
    fake.prisma.invariant.findMany.mockResolvedValue([rule('broken'), rule('fine-1'), rule('fine-2')]);
    fake.evaluateInvariantWindow.mockImplementation(async (invariant: { id: string }) => {
      if (invariant.id === 'broken') throw new Error('database hiccup');
      return { status: 'HEALTHY' };
    });
    await expect(evaluateAllInvariantWindows(new Date('2026-10-16T12:00:00Z'))).resolves.toBeUndefined();
    expect(fake.evaluateInvariantWindow).toHaveBeenCalledTimes(3);
    expect(fake.checkDrift).toHaveBeenCalledWith('fine-1');
    expect(fake.checkDrift).toHaveBeenCalledWith('fine-2');
    expect(fake.checkDrift).not.toHaveBeenCalledWith('broken');
  });

  it('skips rules whose integration is gone', async () => {
    fake.prisma.invariant.findMany.mockResolvedValue([rule('orphan')]);
    fake.evaluateInvariantWindow.mockResolvedValue(null);
    await evaluateAllInvariantWindows();
    expect(fake.checkDrift).not.toHaveBeenCalled();
  });
});
