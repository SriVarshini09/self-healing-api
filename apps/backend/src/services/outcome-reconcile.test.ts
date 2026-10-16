import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  createMany: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../config.js', () => ({ config: { JWT_SECRET: 'x'.repeat(32), SHAPI_ENCRYPTION_KEY: undefined }, blockPrivateDatabaseHosts: () => false }));
vi.mock('../utils/prisma.js', () => ({
  prisma: { outcomeCheckRun: { createMany: fake.createMany }, outcomeCheck: { update: fake.update } },
}));
vi.mock('../utils/logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const { MAX_RECONCILE_EVENTS, reconcileOutcomeCheck } = await import('./outcome-checks.js');
const { encryptSecret } = await import('../utils/secrets.js');

const check = {
  id: 'check-1',
  integrationId: 'int-1',
  name: 'Paid customers are provisioned',
  triggerEventType: 'invoice.payment_succeeded',
  sqlQuery: 'SELECT 1 FROM users WHERE stripe_customer_id = :customer',
  paramBindings: { customer: 'data.object.customer' },
  deadlineSec: 300,
  stripeApiKeyCipher: encryptSecret('rk_test_abc123'),
} as never;

const eventsOf = (count: number) => Array.from({ length: count }, (_, index) => ({
  id: `evt_${index}`, type: 'invoice.payment_succeeded', created: 1_790_000_000 + index, data: { object: { customer: `cus_${index}` } },
}));

describe('Stripe reconcile', () => {
  beforeEach(() => {
    fake.createMany.mockReset().mockResolvedValue({ count: 1 });
    fake.update.mockReset().mockResolvedValue({});
  });

  it('queues a run per event and reports a clean pass', async () => {
    const result = await reconcileOutcomeCheck(check, 0, new Date('2026-10-16T12:00:00Z'), {
      runQuery: vi.fn(),
      listStripeEvents: async () => eventsOf(3),
    });
    expect(result).toEqual({ eventsSeen: 3, runsQueued: 3 });
    expect(fake.update).toHaveBeenCalledWith({ where: { id: 'check-1' }, data: expect.objectContaining({ lastError: null }) });
  });

  it('says so on the check when the event cap was hit, instead of reporting success', async () => {
    await reconcileOutcomeCheck(check, 0, new Date('2026-10-16T12:00:00Z'), {
      runQuery: vi.fn(),
      listStripeEvents: async () => eventsOf(MAX_RECONCILE_EVENTS),
    });
    const { data } = fake.update.mock.calls[0][0] as { data: { lastError: string | null; lastReconciledAt: Date } };
    expect(data.lastError).toMatch(/oldest were not checked/);
    expect(data.lastReconciledAt).toEqual(new Date('2026-10-16T12:00:00Z'));
  });
});
