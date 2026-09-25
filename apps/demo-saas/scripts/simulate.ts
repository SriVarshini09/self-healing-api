// Simulate Stripe webhook flows against demo-saas + SHAPI backend.
// Usage: pnpm --filter @shapi/demo-saas simulate:success|failure|drift
const DEMO = process.env.DEMO_URL ?? 'http://localhost:3000';
const mode = process.argv[2] ?? 'success';

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`${res.status} ${url} -> ${text.slice(0, 200)}`);
  return res;
}

function stripeEvent(customer: string, amount_paid: number) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type: 'invoice.payment_succeeded',
    data: { object: { id: 'in_test', customer, amount_paid, status: 'paid', currency: 'usd' } },
  };
}

async function main() {
  if (mode === 'success' || mode === 'failure') {
    const enableFailure = mode === 'failure';
    await post(`${DEMO}/admin/failure-mode`, { enabled: enableFailure });
    const co = await (await post(`${DEMO}/checkout`, { email: 'founder@test.com', plan: 'pro' })).json().catch(() => ({}));
    const customer = (co as any).customerId ?? 'cus_demo';
    await post(`${DEMO}/webhooks/stripe`, stripeEvent(customer, 2000), { 'stripe-signature': 'test' });
    console.log(enableFailure
      ? 'Sent payment webhook with failureMode=ON (200 OK expected, provisioning.failed tracked)'
      : 'Sent payment webhook with failureMode=OFF (provisioning.completed expected)');
  } else if (mode === 'drift') {
    await post(`${DEMO}/admin/failure-mode`, { enabled: true });
    for (let i = 0; i < 60; i++) {
      await post(`${DEMO}/webhooks/stripe`, stripeEvent(`cus_drift_${i}`, 2000), { 'stripe-signature': 'test' });
    }
    console.log('Sent 60 failing webhooks to trigger drift detection');
  } else {
    console.log('unknown mode; use success|failure|drift');
    process.exit(1);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
