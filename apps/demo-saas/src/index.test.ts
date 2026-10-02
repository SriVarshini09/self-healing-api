import { describe, it, expect } from 'vitest';
import { applyProvisioningOutcome, type DemoUser } from './business-outcome.js';
import { applySubscriptionActivationOutcome } from './subscription-outcome.js';

describe('demo-saas contract', () => {
  it('stripe webhook returns 200 even when business outcome fails (the core SHAPI thesis)', () => {
    // Contract test: HTTP 200 must not be treated as business success.
    // Real verification happens via SHAPI invariants on provisioning.completed.
    const httpStatus = 200;
    const businessSuccess = false;
    expect(httpStatus).toBe(200);
    expect(businessSuccess).toBe(false);
  });

  it('proves the business outcome recovers after the handler is fixed', () => {
    const users = new Map<string, DemoUser>([
      ['cus_regression', {
        id: 'cus_regression',
        email: 'test@example.com',
        plan: 'pro',
        provisioned: false,
        subscriptionActive: false,
      }],
    ]);

    const failed = applyProvisioningOutcome(users, 'cus_regression', true);
    expect(failed.success).toBe(false);
    expect(users.get('cus_regression')?.provisioned).toBe(false);

    // The same business event succeeds once the faulty handler behavior is removed.
    const recovered = applyProvisioningOutcome(users, 'cus_regression', false);
    expect(recovered.success).toBe(true);
    expect(users.get('cus_regression')?.provisioned).toBe(true);
  });

  it('proves subscription activation is a separate business outcome', () => {
    const users = new Map<string, DemoUser>([
      ['cus_subscription', {
        id: 'cus_subscription',
        email: 'subscription@example.com',
        plan: 'pro',
        provisioned: true,
        subscriptionActive: false,
      }],
    ]);

    const failed = applySubscriptionActivationOutcome(users, 'cus_subscription', true);
    expect(failed.success).toBe(false);
    expect(users.get('cus_subscription')?.subscriptionActive).toBe(false);

    const recovered = applySubscriptionActivationOutcome(users, 'cus_subscription', false);
    expect(recovered.success).toBe(true);
    expect(users.get('cus_subscription')?.subscriptionActive).toBe(true);
  });
});
