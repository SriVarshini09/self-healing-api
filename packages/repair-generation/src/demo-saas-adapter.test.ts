import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { proveBusinessOutcomeRepair, type RepairChange } from './index.js';

type DemoUser = {
  id: string;
  email: string;
  plan: string;
  provisioned: boolean;
};

type ProvisioningOutcome = {
  success: boolean;
  details: Record<string, unknown>;
};

type DemoHandler = (
  users: Map<string, DemoUser>,
  customer: string | undefined,
  failureMode: boolean,
) => ProvisioningOutcome;

const targetPath = 'apps/demo-saas/src/business-outcome.ts';
const targetFile = path.resolve(process.cwd(), '../../apps/demo-saas/src/business-outcome.ts');
const originalSource = readFileSync(targetFile, 'utf8');
const reviewedBefore = [
  '  if (failureMode) {',
  '    return {',
  '      success: false,',
  "      details: { reason: 'provisioning skipped (simulated bug)', customer },",
  '    };',
  '  }',
].join('\n') + '\n';
const reviewedAfter = [
  '  // The reviewed repair removes the silent failure branch so payment',
  "  // processing applies the user's provisioning outcome.",
].join('\n') + '\n';

const repair: RepairChange[] = [{
  kind: 'replace',
  path: targetPath,
  before: reviewedBefore,
  after: reviewedAfter,
}];

function loadDemoHandler(source: string): DemoHandler {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: 'business-outcome.ts',
  }).outputText;
  const module: { exports: Record<string, unknown> } = { exports: {} };
  new Function('exports', 'require', 'module', '__filename', '__dirname', compiled)(
    module.exports,
    undefined,
    module,
    targetFile,
    path.dirname(targetFile),
  );
  return module.exports.applyProvisioningOutcome as DemoHandler;
}

function createUsers() {
  return new Map<string, DemoUser>([
    ['cus_target', { id: 'cus_target', email: 'target@example.com', plan: 'pro', provisioned: false }],
  ]);
}

describe('real demo-saas business-outcome adapter', () => {
  it('proves the reviewed patch recovers the real demo provisioning outcome', () => {
    const proof = proveBusinessOutcomeRepair({
      files: { [targetPath]: originalSource },
      targetPath,
      changes: repair,
      load: loadDemoHandler,
      createState: createUsers,
      run: (handler, users) => handler(users, 'cus_target', true),
      reproducesFailure: (result, users) => !result.success && users.get('cus_target')?.provisioned === false,
      provesRecovery: (result, users) => result.success && users.get('cus_target')?.provisioned === true,
    });

    expect(proof.before.result.success).toBe(false);
    expect(proof.after.result.success).toBe(true);
    expect(proof.after.state.get('cus_target')?.provisioned).toBe(true);
  });

  it('fails closed when the real target source drifts from the reviewed precondition', () => {
    expect(() => proveBusinessOutcomeRepair({
      files: { [targetPath]: originalSource.replace('simulated bug', 'changed behavior') },
      targetPath,
      changes: repair,
      load: loadDemoHandler,
      createState: createUsers,
      run: (handler, users) => handler(users, 'cus_target', true),
      reproducesFailure: result => !result.success,
      provesRecovery: result => result.success,
    })).toThrow(/missing-before/);
  });
});
