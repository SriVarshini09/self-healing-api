export type DemoUser = {
  id: string;
  email: string;
  plan: string;
  provisioned: boolean;
};

export type ProvisioningOutcome = {
  success: boolean;
  details: Record<string, unknown>;
};

/**
 * Apply the business outcome behind a successful payment webhook.
 *
 * Keeping this decision separate from the HTTP handler lets the regression
 * test prove the real product behavior: an HTTP 200 can hide a failed
 * provisioning outcome, and a corrected handler can recover the same user.
 */
export function applyProvisioningOutcome(
  users: Map<string, DemoUser>,
  customer: string | undefined,
  failureMode: boolean,
): ProvisioningOutcome {
  if (failureMode) {
    return {
      success: false,
      details: { reason: 'provisioning skipped (simulated bug)', customer },
    };
  }

  const user = users.get(customer ?? '');
  if (!user) {
    return { success: false, details: { reason: 'unknown customer', customer } };
  }

  user.provisioned = true;
  return { success: true, details: { userId: customer, plan: user.plan } };
}
