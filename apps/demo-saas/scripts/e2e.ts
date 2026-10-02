process.env.DEMO_PORT = '3100';
process.env.SHAPI_URL = 'http://localhost:3999';
process.env.SHAPI_API_KEY = 'shapi_demo';

const { server } = await import('../src/index.js');
await new Promise(r => setTimeout(r, 1500));

const DEMO = 'http://localhost:3100';
async function post(path: string, body: unknown) {
  const res = await fetch(`${DEMO}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.text() };
}

try {
  const health = await fetch(`${DEMO}/health`).then(r => r.json());
  console.log('health:', JSON.stringify(health));

  // failure mode ON: webhook must still return 200
  await post('/admin/failure-mode', { enabled: true });
  const co: any = await post('/checkout', { email: 'e2e@test.com', plan: 'pro' }).then(r => JSON.parse(r.body));
  console.log('checkout:', co.customerId);
  const wh = await post('/webhooks/stripe', {
    id: 'evt_e2e',
    type: 'invoice.payment_succeeded',
    data: { object: { customer: co.customerId, amount_paid: 2000, status: 'paid' } },
  });
  console.log('webhook status (must be 200 despite business failure):', wh.status);
  if (wh.status !== 200) throw new Error('demo webhook should return 200');
  const users: any[] = await fetch(`${DEMO}/users`).then(r => r.json());
  const u = users.find((x: any) => x.id === co.customerId);
  console.log('provisioned (must be false):', u?.provisioned);
  if (u?.provisioned) throw new Error('failure mode should skip provisioning');

  // failure mode OFF: provisioning works
  await post('/admin/failure-mode', { enabled: false });
  const co2: any = await post('/checkout', { email: 'ok@test.com', plan: 'pro' }).then(r => JSON.parse(r.body));
  await post('/webhooks/stripe', {
    id: 'evt_e2e2',
    type: 'invoice.payment_succeeded',
    data: { object: { customer: co2.customerId, amount_paid: 2000, status: 'paid' } },
  });
  const users2: any[] = await fetch(`${DEMO}/users`).then(r => r.json());
  const u2 = users2.find((x: any) => x.id === co2.customerId);
  console.log('provisioned (must be true):', u2?.provisioned);
  if (!u2?.provisioned) throw new Error('success mode should provision');

  // The second business outcome uses the same customer but a distinct event
  // contract, proving subscription activation is not conflated with payment
  // provisioning.
  await post('/admin/failure-mode', { enabled: true });
  const subscriptionCustomer: any = await post('/checkout', { email: 'subscription-failure@test.com', plan: 'pro' }).then(r => JSON.parse(r.body));
  const failedSubscription = await post('/webhooks/stripe', {
    id: 'evt_subscription_failure',
    type: 'customer.subscription.created',
    data: { object: { customer: subscriptionCustomer.customerId, status: 'active' } },
  });
  if (failedSubscription.status !== 200) throw new Error('subscription webhook should return 200');
  const afterFailedSubscription: any[] = await fetch(`${DEMO}/users`).then(r => r.json());
  if (afterFailedSubscription.find((x: any) => x.id === subscriptionCustomer.customerId)?.subscriptionActive) {
    throw new Error('failure mode should skip subscription activation');
  }

  await post('/admin/failure-mode', { enabled: false });
  const activeSubscriptionCustomer: any = await post('/checkout', { email: 'subscription-ok@test.com', plan: 'pro' }).then(r => JSON.parse(r.body));
  const successfulSubscription = await post('/webhooks/stripe', {
    id: 'evt_subscription_success',
    type: 'customer.subscription.created',
    data: { object: { customer: activeSubscriptionCustomer.customerId, status: 'active' } },
  });
  if (successfulSubscription.status !== 200) throw new Error('subscription webhook should return 200 after recovery');
  const afterSuccessfulSubscription: any[] = await fetch(`${DEMO}/users`).then(r => r.json());
  if (!afterSuccessfulSubscription.find((x: any) => x.id === activeSubscriptionCustomer.customerId)?.subscriptionActive) {
    throw new Error('success mode should activate the subscription');
  }

  console.log('DEMO E2E OK');
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}
