import type { FastifyInstance } from 'fastify';
import { webhookRoutes } from './webhooks.js';
import { integrationRoutes } from './integrations.js';
import { invariantRoutes } from './invariants.js';
import { incidentRoutes } from './incidents.js';
import { driftRoutes } from './drift.js';
import { githubRoutes } from './github.js';
import { sdkRoutes } from './sdk.js';
import { isPublicPath, authenticateApiKey } from '../utils/api-keys.js';

export async function registerRoutes(app: FastifyInstance) {
  await app.register(async api => {
    // API-key enforcement for everything under /api/v1 except third-party
    // webhook receivers (Stripe/GitHub HMAC) which carry their own auth.
    // Send `x-api-key`. Local demo key: see README / .env SHAPI_API_KEY.
    api.addHook('onRequest', async (request, reply) => {
      if (isPublicPath(request.raw.url ?? '')) return;
      const key = await authenticateApiKey(request.headers['x-api-key'] as string | undefined);
      if (!key) {
        return reply.code(401).send({ error: 'Missing or invalid x-api-key' });
      }
    });

    await api.register(webhookRoutes);
    await api.register(integrationRoutes);
    await api.register(invariantRoutes);
    await api.register(incidentRoutes);
    await api.register(driftRoutes);
    await api.register(githubRoutes);
    await api.register(sdkRoutes);
  }, { prefix: '/api/v1' });

  // Root endpoint
  app.get('/', async () => ({
    name: 'SHAPI API',
    version: '0.0.1',
    description: 'Behavioral Dependency Assurance Platform',
    docs: '/docs'
  }));
}