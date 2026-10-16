// Child process: load one kit variant fresh and deliver every scenario event
// to the kit's real webhook route, signed exactly as Stripe signs them.
// Prints one JSON line: { deliveries: [{ eventId, status, error? }] }.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import Stripe from 'stripe';
import { KITS } from './kits/index.js';
import { startFakeStripeApi } from './fake-stripe-api.js';

const kit = KITS.find(candidate => candidate.name === process.argv[2]);
if (!kit) throw new Error(`unknown kit ${process.argv[2]}`);
const kitDir = join(import.meta.dirname, '..', '.kits', kit.name);

if (kit.stripeApi) await startFakeStripeApi(kit.stripeApi);

const route = await import(pathToFileURL(join(kitDir, kit.routeFile)).href) as {
  POST: (request: Request) => Promise<Response>;
};
const signer = new Stripe('sk_test_benchmark_not_a_real_key');

declare global {
  // eslint-disable-next-line no-var
  var __benchRequestHeaders: Record<string, string> | undefined;
}

const deliveries: Array<{ eventId: string; status: number; error?: string }> = [];
for (const scenario of kit.scenarios) {
  for (const event of scenario.events) {
    const payload = JSON.stringify(event);
    const signature = signer.webhooks.generateTestHeaderString({ payload, secret: kit.webhookSecret });
    try {
      // Handlers that read the signature via next/headers() see this request's headers.
      globalThis.__benchRequestHeaders = { 'content-type': 'application/json', 'stripe-signature': signature };
      const response = await route.POST(new Request('http://benchmark.local/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': signature },
        body: payload,
      }));
      deliveries.push({ eventId: event.id, status: response.status });
    } catch (error) {
      // An uncaught throw becomes a 500 in Next.js, which Stripe retries: a loud failure.
      deliveries.push({ eventId: event.id, status: 500, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

// Let un-awaited writes (if any) settle the way a long-lived server would.
await new Promise(resolve => setTimeout(resolve, 300));
console.log(`__RESULT__${JSON.stringify({ deliveries })}`);
process.exit(0);
