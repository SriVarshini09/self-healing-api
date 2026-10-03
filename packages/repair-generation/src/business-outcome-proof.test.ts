import { describe, expect, it } from 'vitest';
import { proveBusinessOutcomeRepair, type RepairChange } from './index.js';

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
    const proof = proveBusinessOutcomeRepair({
      files: { [targetPath]: buggyTargetSource },
      targetPath,
      changes: repair,
      load: loadTarget,
      createState: () => new Map<string, TargetUser>([['cus_target', { provisioned: false }]]),
      run: (handler, users) => handler(users, 'cus_target', true),
      reproducesFailure: (result, users) => !result.success && users.get('cus_target')?.provisioned === false,
      provesRecovery: (result, users) => result.success && users.get('cus_target')?.provisioned === true,
    });

    expect(proof.before.result.success).toBe(false);
    expect(proof.after.result.success).toBe(true);
  });

  it('fails closed when the target source no longer matches the reviewed patch', () => {
    expect(() => proveBusinessOutcomeRepair({
      files: { [targetPath]: buggyTargetSource.replace('provisioning skipped', 'different behavior') },
      targetPath,
      changes: repair,
      load: loadTarget,
      createState: () => new Map<string, TargetUser>([['cus_target', { provisioned: false }]]),
      run: (handler, users) => handler(users, 'cus_target', true),
      reproducesFailure: result => !result.success,
      provesRecovery: result => result.success,
    })).toThrow(/missing-before/);
  });

  it('fails closed when the baseline does not reproduce the reviewed failure', () => {
    expect(() => proveBusinessOutcomeRepair({
      files: { [targetPath]: buggyTargetSource },
      targetPath,
      changes: repair,
      load: loadTarget,
      createState: () => new Map<string, TargetUser>([['cus_target', { provisioned: false }]]),
      run: (handler, users) => handler(users, 'cus_target', false),
      reproducesFailure: result => !result.success,
      provesRecovery: result => result.success,
    })).toThrow(/did not reproduce/);
  });

  it('fails closed when the reviewed changes do not touch the target file', () => {
    expect(() => proveBusinessOutcomeRepair({
      files: { [targetPath]: buggyTargetSource, 'src/other.js': 'module.exports = 1;\n' },
      targetPath,
      changes: [{
        kind: 'replace',
        path: 'src/other.js',
        before: 'module.exports = 1;',
        after: 'module.exports = 2;',
      }],
      load: loadTarget,
      createState: () => new Map<string, TargetUser>([['cus_target', { provisioned: false }]]),
      run: (handler, users) => handler(users, 'cus_target', true),
      reproducesFailure: (result, users) => !result.success && users.get('cus_target')?.provisioned === false,
      provesRecovery: (result, users) => result.success && users.get('cus_target')?.provisioned === true,
    })).toThrow(/does not change the declared target file/);
  });

  it('fails closed when the reviewed target change is a no-op', () => {
    expect(() => proveBusinessOutcomeRepair({
      files: { [targetPath]: buggyTargetSource },
      targetPath,
      changes: [{
        kind: 'replace',
        path: targetPath,
        before: 'provisioning skipped',
        after: 'provisioning skipped',
      }],
      load: loadTarget,
      createState: () => new Map<string, TargetUser>([['cus_target', { provisioned: false }]]),
      run: (handler, users) => handler(users, 'cus_target', true),
      reproducesFailure: (result, users) => !result.success && users.get('cus_target')?.provisioned === false,
      provesRecovery: (result, users) => result.success && users.get('cus_target')?.provisioned === true,
    })).toThrow(/did not change the declared target source/);
  });
});
