import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const settings = vi.hoisted(() => ({
  config: { SHAPI_EGRESS_IPS: undefined as string[] | undefined, SHAPI_ENCRYPTION_KEY: undefined as string | undefined, SHAPI_CONTACT_EMAIL: undefined as string | undefined },
  block: false,
}));
vi.mock('../../config.js', () => ({ config: settings.config, blockPrivateDatabaseHosts: () => settings.block }));

const { trustRoutes } = await import('../trust.js');

async function get() {
  const app = Fastify();
  await app.register(trustRoutes, { prefix: '/api/v1' });
  const response = await app.inject({ method: 'GET', url: '/api/v1/trust' });
  await app.close();
  return { status: response.statusCode, body: JSON.parse(response.body) };
}

describe('GET /trust', () => {
  it('reports an unconfigured instance honestly', async () => {
    expect(await get()).toEqual({
      status: 200,
      body: { egressIps: [], dedicatedEncryptionKey: false, privateDatabaseHostsBlocked: false },
    });
  });

  it('publishes egress IPs and posture, but never the key itself', async () => {
    settings.config.SHAPI_EGRESS_IPS = ['44.226.145.213', '44.229.200.0/24'];
    settings.config.SHAPI_ENCRYPTION_KEY = 'super-secret-encryption-key-0123456789';
    settings.block = true;
    const { body } = await get();
    expect(body).toEqual({ egressIps: ['44.226.145.213', '44.229.200.0/24'], dedicatedEncryptionKey: true, privateDatabaseHostsBlocked: true });
    expect(JSON.stringify(body)).not.toContain('super-secret');
  });

  it('publishes the contact address only when the operator sets one', async () => {
    expect((await get()).body.contactEmail).toBeUndefined();
    settings.config.SHAPI_CONTACT_EMAIL = 'privacy@example.com';
    expect((await get()).body.contactEmail).toBe('privacy@example.com');
  });
});
