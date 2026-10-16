import type { FastifyInstance } from 'fastify';
import { blockPrivateDatabaseHosts, config } from '../config.js';

/**
 * Public (no auth): the facts a founder needs before giving SHAPI a database
 * URL. Booleans only; never key material or internal hostnames.
 */
export async function trustRoutes(app: FastifyInstance) {
  app.get('/trust', async (_request, reply) => reply.send({
    // Where to send privacy and legal requests; shown on the Terms and Privacy pages.
    contactEmail: config.SHAPI_CONTACT_EMAIL,
    // IPs/CIDRs to allowlist on the customer's database firewall. Empty = not published by this operator.
    egressIps: config.SHAPI_EGRESS_IPS ?? [],
    // Stored secrets use a dedicated key, independent of the login-session secret.
    dedicatedEncryptionKey: Boolean(config.SHAPI_ENCRYPTION_KEY),
    // Outcome checks refuse databases on private/internal addresses.
    privateDatabaseHostsBlocked: blockPrivateDatabaseHosts(),
  }));
}
