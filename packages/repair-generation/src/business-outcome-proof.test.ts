import { describe, expect, it } from 'vitest';
import { applyRepairChanges, type RepairChange } from './changes.js';

type TargetUser = { provisioned: boolean };
type TargetResult = { success: boolean; reason?: string };
type TargetHandler = (
  users: Map<string, TargetUser>,
  customer: string,
  failureMode: boolean,
) => TargetResult;

const targetPath = 'src/provisioning.js';
const buggyTargetSource = `
module.exports = function handlePayment(users, customer, failureMode) {
  const user = users.get(customer);
  if (!user) return { success: false, reason: 'unknown customer' };
  if (failureMode) {
    return { success: false, reason: 'provisioning skipped' };
  }
  user.provisioned = true;
  return { success: true };
};
`;

const repair: RepairChange[] = [{
  kind: 'replace',
  path: targetPath,
  before: `  if (failureMode) {
    return { success: false, reason: 'provisioning skipped' };
  }
`,
  after: `  // The repair removes the silent failure branch so the business outcome is applied.
`,
}];

function loadTarget(source: string): TargetHandler {
  const module: { exports: unknown } = { exports: undefined };
  new Function('module', 'exports', source)(module, module.exports);
  return module.exports as TargetHandler;
}

describe('structured repair business-outcome proof', () => {
  it('applies the exact target patch and proves provisioning succeeds', () => {
    const buggy = loadTarget(buggyTargetSource);
    const buggyUsers = new Map<string, TargetUser>([['cus_target', { provisioned: false }]]);
    const before = buggy(buggyUsers, 'cus_target', true);
    expect(before.success).toBe(false);
    expect(buggyUsers.get('cus_target')?.provisioned).toBe(false);

    const patchedFiles = applyRepairChanges({ [targetPath]: buggyTargetSource }, repair);
    const fixed = loadTarget(patchedFiles[targetPath]);
    const fixedUsers = new Map<string, TargetUser>([['cus_target', { provisioned: false }]]);
    const after = fixed(fixedUsers, 'cus_target', true);

    expect(after.success).toBe(true);
    expect(fixedUsers.get('cus_target')?.provisioned).toBe(true);
  });

  it('fails closed when the target source no longer matches the reviewed patch', () => {
    expect(() => applyRepairChanges({ [targetPath]: buggyTargetSource.replace('provisioning skipped', 'different behavior') }, repair)).toThrow(/missing-before/);
  });
});
