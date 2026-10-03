import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  updateMany: vi.fn(),
}));

vi.mock('../config.js', () => ({
  config: {
    ALERT_WEBHOOK_MAX_ATTEMPTS: 3,
    ALERT_WEBHOOK_URL: 'https://alerts.example.test/hooks/shapi',
  },
}));

vi.mock('../utils/prisma.js', () => ({
  prisma: { alertDelivery: { updateMany: fake.updateMany } },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn() },
}));

import { reclaimStaleProcessingAlerts } from './alerts.js';

describe('stale alert delivery recovery', () => {
  beforeEach(() => {
    fake.updateMany.mockReset();
  });

  it('retries stale deliveries below the attempt limit and fails exhausted deliveries', async () => {
    const now = new Date('2026-10-01T00:05:00.000Z');

    await reclaimStaleProcessingAlerts(now);

    expect(fake.updateMany).toHaveBeenCalledTimes(2);
    expect(fake.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        status: 'PROCESSING',
        updatedAt: { lt: new Date('2026-10-01T00:00:00.000Z') },
        attempts: { gte: 3 },
      },
      data: {
        status: 'FAILED',
        nextAttemptAt: now,
        lastError: 'delivery attempt expired before completion',
      },
    });
    expect(fake.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        status: 'PROCESSING',
        updatedAt: { lt: new Date('2026-10-01T00:00:00.000Z') },
        attempts: { lt: 3 },
      },
      data: {
        status: 'RETRYING',
        nextAttemptAt: now,
        lastError: 'delivery attempt expired before completion',
      },
    });
  });
});
