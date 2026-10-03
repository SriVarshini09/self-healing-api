import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signAlertBody } from './alerts-core.js';

const fake = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../config.js', () => ({
  config: {
    ALERT_WEBHOOK_MAX_ATTEMPTS: 3,
    ALERT_WEBHOOK_SECRET: 'alert-secret',
    ALERT_WEBHOOK_TIMEOUT_MS: 5_000,
    ALERT_WEBHOOK_URL: 'https://alerts.example.test/hooks/shapi',
  },
}));

vi.mock('../utils/prisma.js', () => ({
  prisma: { alertDelivery: fake },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn() },
}));

import { deliverPendingAlerts } from './alerts.js';

const incident = {
  id: 'incident-1',
  title: 'Provisioning drift',
  description: 'The user was not provisioned',
  severity: 'HIGH',
  status: 'DETECTED',
  detectedAt: new Date('2026-10-01T00:00:00.000Z'),
  integration: { id: 'integration-1', name: 'Demo SaaS', type: 'DEMO' },
  invariant: { id: 'invariant-1', name: 'Provisioning outcome' },
};

describe('alert outbox delivery state transitions', () => {
  beforeEach(() => {
    fake.findMany.mockReset();
    fake.updateMany.mockReset();
    fake.update.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('marks a claimed delivery delivered after a successful receiver response', async () => {
    fake.findMany.mockResolvedValue([{ id: 'delivery-1', attempts: 0, incident }]);
    fake.updateMany.mockResolvedValue({ count: 1 });
    fake.update.mockResolvedValue({});
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    const now = new Date('2026-10-01T00:00:10.000Z');

    await deliverPendingAlerts(now, 5);

    expect(fake.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'delivery-1',
        status: { in: ['PENDING', 'RETRYING'] },
      },
      data: { status: 'PROCESSING', attempts: { increment: 1 } },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://alerts.example.test/hooks/shapi');
    expect(request.method).toBe('POST');
    expect(request.headers).toMatchObject({
      'x-shapi-alert-event': 'incident.detected',
      'x-shapi-alert-signature': signAlertBody(String(request.body), 'alert-secret'),
    });
    expect(JSON.parse(String(request.body))).toMatchObject({
      event: 'incident.detected',
      incident: { id: 'incident-1' },
    });
    expect(fake.update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: {
        status: 'DELIVERED',
        httpStatus: 202,
        deliveredAt: expect.any(Date),
        lastError: null,
      },
    });
  });

  it('moves a receiver failure back to retrying with bounded backoff', async () => {
    fake.findMany.mockResolvedValue([{ id: 'delivery-1', attempts: 1, incident }]);
    fake.updateMany.mockResolvedValue({ count: 1 });
    fake.update.mockResolvedValue({});
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
    const now = new Date('2026-10-01T00:00:10.000Z');

    await deliverPendingAlerts(now, 5);

    expect(fake.update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: {
        status: 'RETRYING',
        nextAttemptAt: new Date('2026-10-01T00:00:12.000Z'),
        lastError: 'Alert receiver returned HTTP 503',
      },
    });
  });
});
