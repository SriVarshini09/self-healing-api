import type { FastifyRequest } from 'fastify';

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first?.split(',')[0]?.trim() || undefined;
}

/**
 * The API's public origin, as providers (Stripe, GitHub) must call it:
 * BACKEND_URL when set, else the URL Render assigns the service
 * (RENDER_EXTERNAL_URL), else the origin this request arrived on.
 */
export function publicApiOrigin(request: FastifyRequest): string {
  const configured = process.env.BACKEND_URL || process.env.RENDER_EXTERNAL_URL;
  if (configured) return configured.replace(/\/+$/, '');
  const protocol = header(request, 'x-forwarded-proto') ?? request.protocol;
  const host = header(request, 'x-forwarded-host') ?? header(request, 'host') ?? 'localhost';
  return `${protocol}://${host}`;
}
