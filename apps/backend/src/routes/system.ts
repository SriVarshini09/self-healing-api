import type { FastifyInstance } from 'fastify';
import { getSelfStatus } from '../services/self-monitor.js';

/**
 * Is SHAPI itself working? Any signed-in person or API key can ask, so the
 * dashboard can say so instead of showing a calm "all clear" while SHAPI is
 * not processing anything. No counts or other workspaces' data.
 */
export async function systemRoutes(app: FastifyInstance) {
  app.get('/system/status', async (_request, reply) => {
    const { status, checkedAt, checks } = await getSelfStatus();
    return reply.send({ status, checkedAt, checks: checks.map(({ label, ok, detail }) => ({ label, ok, detail })) });
  });
}
