// An in-process stand-in for api.stripe.com, for kits whose webhook handler calls
// back into the Stripe API (e.g. stripe.subscriptions.retrieve). The Stripe SDK talks
// to https://api.stripe.com through node:https; requests for that host are re-pointed
// at a local HTTP server that answers from the kit's fixtures. Nothing leaves the machine.
import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';

export async function startFakeStripeApi(fixtures: { subscriptions?: Record<string, Record<string, unknown>> }): Promise<void> {
  const server = http.createServer((request, response) => {
    const match = /^\/v1\/subscriptions\/([^/?]+)/.exec(request.url ?? '');
    const found = match ? fixtures.subscriptions?.[decodeURIComponent(match[1])] : undefined;
    response.setHeader('content-type', 'application/json');
    response.setHeader('request-id', 'req_benchmark_fake');
    if (found) {
      response.statusCode = 200;
      response.end(JSON.stringify(found));
    } else {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: { type: 'invalid_request_error', message: `No such object: ${request.url}`, code: 'resource_missing' } }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  server.unref();

  const realRequest = https.request.bind(https);
  (https as { request: unknown }).request = (...args: unknown[]) => {
    const [first, ...rest] = args as [unknown, ...unknown[]];
    const options = (typeof first === 'object' && first !== null && !(first instanceof URL) ? first : {}) as Record<string, unknown>;
    if (options.host === 'api.stripe.com' || options.hostname === 'api.stripe.com') {
      // Re-point at the fake over plain HTTP; the Stripe SDK's own agent is TLS-only.
      const request = http.request({ ...options, host: '127.0.0.1', hostname: '127.0.0.1', port, agent: undefined, protocol: 'http:' } as http.RequestOptions, ...(rest as []));
      // The SDK sends its body only after the TLS handshake event; a plain socket
      // reports `connect` instead, so translate it.
      const once = request.once.bind(request) as (event: string, listener: (...args: never[]) => void) => unknown;
      (request as { once: unknown }).once = (event: string, listener: (socket: import('node:net').Socket) => void) =>
        event === 'socket'
          ? once('socket', ((socket: import('node:net').Socket) => {
              const socketOnce = socket.once.bind(socket) as (e: string, l: (...a: unknown[]) => void) => unknown;
              (socket as { once: unknown }).once = (e: string, l: (...a: unknown[]) => void) => socketOnce(e === 'secureConnect' ? 'connect' : e, l);
              listener(socket);
            }) as never)
          : once(event, listener as never);
      return request;
    }
    return (realRequest as (...a: unknown[]) => unknown)(...args);
  };
}
