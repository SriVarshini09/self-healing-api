import { describe, it, expect, vi } from 'vitest';
import { Shapi } from './index.js';

describe('sdk', () => {
  it('requires apiKey', () => {
    expect(() => new Shapi({ apiKey: '' } as any)).toThrow();
  });

  it('track() posts to backend', async () => {
    const fetchMock = vi.fn(async (..._args: any[]) => ({ ok: true, status: 200 }) as any);
    (globalThis as any).fetch = fetchMock;
    const client = new Shapi({ apiKey: 'shapi_test', apiUrl: 'http://localhost:3001' });
    const res = await client.track('stripe', 'invoice.payment_succeeded', { amount_paid: 2000 });
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/v1/sdk/track');
    expect((init as any).headers['x-api-key']).toBe('shapi_test');
  });

  it('webhookReporter still runs business logic when telemetry backend is down', async () => {
    (globalThis as any).fetch = vi.fn(async () => {
      throw new Error('connect refused');
    });
    const client = new Shapi({ apiKey: 'k' });
    const report = client.webhookReporter('stripe');
    const outcome = await report('invoice.payment_succeeded', { amount_paid: 2000 }, async () => ({
      success: true,
      details: { userId: 'u1' },
    }));
    expect(outcome.success).toBe(true);
  });

  it('webhookReporter reports business outcome even when handler throws', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init: any) => {
      calls.push(JSON.parse(init.body).type);
      return { ok: true, status: 200 } as any;
    });
    (globalThis as any).fetch = fetchMock;
    const client = new Shapi({ apiKey: 'k' });
    const report = client.webhookReporter('stripe');
    await expect(
      report('invoice.payment_succeeded', { amount_paid: 0 }, async () => {
        throw new Error('provisioning failed');
      }),
    ).rejects.toThrow('provisioning failed');
    expect(calls).toEqual(['invoice.payment_succeeded', 'provisioning.failed']);
  });

  it('webhookReporter supports explicit business outcome event names', async () => {
    const calls: string[] = [];
    (globalThis as any).fetch = vi.fn(async (_url: string, init: any) => {
      calls.push(JSON.parse(init.body).type);
      return { ok: true, status: 200 } as any;
    });
    const client = new Shapi({ apiKey: 'k' });
    const report = client.webhookReporter('stripe', {
      success: 'subscription.activated',
      failure: 'subscription.activation_failed',
    });

    const outcome = await report('customer.subscription.created', { customer: 'cus_1' }, async () => ({
      success: true,
      details: { customer: 'cus_1' },
    }));

    expect(outcome.success).toBe(true);
    expect(calls).toEqual(['customer.subscription.created', 'subscription.activated']);
  });

  it('rejects empty explicit business outcome event names', () => {
    const client = new Shapi({ apiKey: 'k' });
    expect(() => client.webhookReporter('stripe', { success: '', failure: 'failed' })).toThrow(/event names/);
  });
});
