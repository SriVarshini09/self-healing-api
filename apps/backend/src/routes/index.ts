import type { FastifyInstance, FastifyRequest } from 'fastify';
import { webhookRoutes } from './webhooks.js';
import { integrationRoutes } from './integrations.js';
import { invariantRoutes } from './invariants.js';
import { incidentRoutes } from './incidents.js';
import { driftRoutes } from './drift.js';
import { githubRoutes } from './github.js';
import { sdkRoutes } from './sdk.js';
import { apiKeyRoutes, bootstrapRoutes } from './api-keys.js';
import { authRoutes } from './auth.js';
import { alertRoutes } from './alerts.js';
import { outcomeCheckRoutes } from './outcome-checks.js';
import { statsRoutes } from './stats.js';
import { workspaceRoutes } from './workspace.js';
import { trustRoutes } from './trust.js';
import { stripeChangeRoutes } from './stripe-changes.js';
import { inviteRequestRoutes } from './invite-requests.js';
import { isPublicPath, authenticateApiKey, hasPermission, requiredPermission } from '../utils/api-keys.js';
import { authenticateSession, getCookie, SESSION_COOKIE } from '../utils/auth-sessions.js';
import type { AuthenticatedRequest } from '../utils/auth-context.js';

export async function registerRoutes(app: FastifyInstance) {
  app.decorateRequest('shapiAuth', null);
  await app.register(async api => {
    // API-key enforcement for everything under /api/v1 except third-party
    // webhook receivers (Stripe/GitHub HMAC) which carry their own auth.
    // Send `x-api-key`, or use the browser session created by OIDC login.
    api.addHook('onRequest', async (request, reply) => {
      if (isPublicPath(request.raw.url ?? '')) return;
      const key = await authenticateApiKey(request.headers['x-api-key'] as string | undefined)
        ?? await authenticateSession(getCookie(request.headers.cookie, SESSION_COOKIE));
      if (!key) {
        return reply.code(401).send({ error: 'Missing or invalid x-api-key' });
      }
      if (!hasPermission(key, requiredPermission(request.method))) {
        return reply.code(403).send({ error: 'Insufficient API-key permissions' });
      }
      (request as FastifyRequest & AuthenticatedRequest).shapiAuth = key;
    });

    await api.register(webhookRoutes);
    await api.register(integrationRoutes);
    await api.register(invariantRoutes);
    await api.register(incidentRoutes);
    await api.register(driftRoutes);
    await api.register(githubRoutes);
    await api.register(sdkRoutes);
    await api.register(apiKeyRoutes);
    await api.register(bootstrapRoutes);
    await api.register(authRoutes);
    await api.register(alertRoutes);
    await api.register(outcomeCheckRoutes);
    await api.register(statsRoutes);
    await api.register(workspaceRoutes);
    await api.register(trustRoutes);
    await api.register(stripeChangeRoutes);
    await api.register(inviteRequestRoutes);
  }, { prefix: '/api/v1' });

  // Root endpoint
  app.get('/', async () => ({
    name: 'SHAPI API',
    version: '0.0.1',
    description: 'Behavioral Dependency Assurance Platform',
    docs: '/docs'
  }));
}
