import Fastify from 'fastify';
import { config } from './config.js';
import { registerPlugins } from './plugins/index.js';
import { registerRoutes } from './routes/index.js';
import { logger } from './utils/logger.js';
import { startEvaluationScheduler } from './services/scheduler.js';

async function main() {
  const app = Fastify({
    logger: config.NODE_ENV === 'development' ? {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname'
        }
      }
    } : false
  });

  try {
    await registerPlugins(app);
    await registerRoutes(app);

    let stopScheduler: () => void = () => undefined;
    app.addHook('onClose', async () => stopScheduler());
    await app.listen({ port: config.PORT, host: config.HOST });
    stopScheduler = startEvaluationScheduler(config.INVARIANT_EVALUATION_INTERVAL_SEC);
    logger.info(`🚀 Server listening on http://${config.HOST}:${config.PORT}`);
    logger.info(`📚 API Docs: http://${config.HOST}:${config.PORT}/docs`);
  } catch (err) {
    logger.error(err, 'Failed to start server');
    process.exit(1);
  }
}

void main();
