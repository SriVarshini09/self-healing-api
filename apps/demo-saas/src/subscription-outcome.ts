import type { DemoUser, ProvisioningOutcome } from './business-outcome.js';

/**
 * Apply the business outcome behind a newly-created subscription.
 *
 * This is intentionally separate from payment provisioning so SHAPI can prove
 * two distinct target-app outcomes, each with its own reviewed repair adapter.
 */
export function applySubscriptionActivationOutcome(
  users: Map<string, DemoUser>,
  customer: string | undefined,
  failureMode: boolean,
): ProvisioningOutcome {
  if (failureMode) {
    return {
      success: false,
      details: { reason: 'subscription activation skipped (simulated bug)', customer },
    };
  }

  const user = users.get(customer ?? '');
  if (!user) {
    return { success: false, details: { reason: 'unknown customer', customer } };
  }

  user.subscriptionActive = true;
  return { success: true, details: { userId: customer, plan: user.plan } };
}
