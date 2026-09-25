import { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { prisma } from '../utils/prisma.js';

export async function registerPlugins(app: FastifyInstance) {
  // Raw body capture for HMAC webhook verification (opt-in per route via config.rawBody).
  await app.register(import('fastify-raw-body'), {
    field: 'rawBody',
    global: false,
    encoding: 'utf8',
    runFirst: true,
  });

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
    max: 1000,
    timeWindow: '1 minute'
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
}