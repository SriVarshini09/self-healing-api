import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { prisma } from '../utils/prisma.js';
import { serializeJson } from '../utils/json.js';
import { incrementCounter, renderPrometheus } from '../utils/metrics.js';
import { logger } from '../utils/logger.js';
import { rateLimitKey } from '../utils/rate-limit.js';

export async function registerPlugins(app: FastifyInstance) {
  // Prisma models carry BigInt columns (e.g. GitHubInstallation.githubInstallationId)
  // which JSON.stringify cannot serialize. Convert safely instead of 500ing.
  app.setReplySerializer(serializeJson);

  app.addHook('onResponse', async (request, reply) => {
    incrementCounter('shapi_http_requests_total', {
      method: request.method,
      route: request.routeOptions.url ?? 'unknown',
      status_code: reply.statusCode,
    });
  });

  // Raw body capture for HMAC webhook verification (opt-in per route via config.rawBody).
  await app.register(import('fastify-raw-body'), {
    field: 'rawBody',
    global: false,
    encoding: 'utf8',
    runFirst: true,
  });

  // Twilio sends form-encoded webhook parameters; keep this parser available
  // before provider signature verification runs.
  await app.register(import('@fastify/formbody'));

  // Helmet for security headers
  await app.register(import('@fastify/helmet'), {
    contentSecurityPolicy: false
  });

  // CORS
  await app.register(import('@fastify/cors'), {
    origin: [config.DASHBOARD_URL, config.DEMO_SAAS_URL],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  });

  // Rate limiting
  await app.register(import('@fastify/rate-limit'), {
    max: config.API_RATE_LIMIT_MAX,
    timeWindow: config.API_RATE_LIMIT_WINDOW,
    keyGenerator: rateLimitKey,
  });

  // Swagger/OpenAPI
  await app.register(import('@fastify/swagger'), {
    openapi: {
      info: {
        title: 'SHAPI API',
        description: 'Behavioral Dependency Assurance Platform API',
        version: '0.0.1'
      },
      servers: [
        { url: `http://${config.HOST}:${config.PORT}`, description: 'Development' }
      ],
      components: {
        securitySchemes: {
          apiKey: {
            type: 'apiKey',
            name: 'x-api-key',
            in: 'header'
          }
        }
      }
    }
  });

  await app.register(import('@fastify/swagger-ui'), {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true
    }
  });

  // Prisma decorator
  app.decorate('prisma', prisma);

  // Health check
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  app.get('/ready', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return reply.send({ status: 'ready', timestamp: new Date().toISOString() });
    } catch (error) {
      logger.error({ error }, 'Readiness check failed');
      return reply.code(503).send({ status: 'not_ready' });
    }
  });

  app.get('/metrics', async (_request, reply) => {
    return reply.type('text/plain; version=0.0.4').send(renderPrometheus());
  });
}
