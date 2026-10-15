import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { prisma } from '../utils/prisma.js';
import { serializeJson } from '../utils/json.js';
import { incrementCounter, isMetricsTokenValid, renderPrometheus } from '../utils/metrics.js';
import { logger } from '../utils/logger.js';
import { rateLimitKey } from '../utils/rate-limit.js';
import { apiDocsCss, apiDocsJs } from '../docs-theme.js';

export async function registerPlugins(app: FastifyInstance) {
  // Prisma models carry BigInt columns (e.g. GitHubInstallation.githubInstallationId)
  // which JSON.stringify cannot serialize. Convert safely instead of 500ing.
  app.setReplySerializer(serializeJson);

  // One place for errors that escape a route: "record not found" is a 404,
  // client errors keep their message, and server errors are logged in full but
  // answered without internals (no database messages or file paths).
  app.setErrorHandler((error, request, reply) => {
    const code = (error as { code?: string }).code;
    if (code === 'P2025') return reply.code(404).send({ error: 'Not found' });
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (status < 500) return reply.code(status).send({ error: error.message });
    logger.error({ requestId: request.id, method: request.method, url: request.url, error: error.message, stack: error.stack }, 'Unhandled route error');
    return reply.code(500).send({ error: 'Something went wrong on our side. Please try again.', requestId: request.id });
  });

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
        title: 'SHAPI API Console',
        description: 'Behavioral dependency assurance and recovery API. Use the console to inspect live health, readiness, incidents, integrations, invariants, and repair workflows.',
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
    theme: {
      title: 'SHAPI API Console',
      css: [{ filename: 'shapi-api-console.css', content: apiDocsCss }],
      js: [{ filename: 'shapi-api-console.js', content: apiDocsJs }]
    },
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true
    }
  });

  // Prisma decorator
  app.decorate('prisma', prisma);
  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

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

  app.get('/metrics', async (request, reply) => {
    if (config.NODE_ENV === 'production') {
      const header = request.headers['x-metrics-token'];
      const authorization = request.headers.authorization;
      const provided = typeof header === 'string'
        ? header
        : typeof authorization === 'string' && authorization.startsWith('Bearer ')
          ? authorization.slice('Bearer '.length)
          : undefined;
      if (!isMetricsTokenValid(provided, config.METRICS_TOKEN)) {
        return reply.code(404).send({ error: 'Not found' });
      }
    }
    return reply.type('text/plain; version=0.0.4').send(renderPrometheus());
  });
}
