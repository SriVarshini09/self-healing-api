import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import {
  DEMO_SAAS_PROVISIONING_ADAPTER_ID,
  DEMO_SAAS_PROVISIONING_PATH,
  DEMO_SAAS_PROVISIONING_REPAIR,
  reviewedBusinessOutcomeAdapter,
  proveBusinessOutcomeRepair,
} from './index.js';

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

const targetPath = DEMO_SAAS_PROVISIONING_PATH;
const targetFile = path.resolve(process.cwd(), '../../apps/demo-saas/src/business-outcome.ts');
const originalSource = readFileSync(targetFile, 'utf8');

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
  it('exposes explicit reviewed adapter metadata', () => {
    expect(reviewedBusinessOutcomeAdapter('SriVarshini09/self-healing-api', targetPath)).toMatchObject({
      adapterId: DEMO_SAAS_PROVISIONING_ADAPTER_ID,
      requiredCheck: 'business-outcome',
    });
    expect(reviewedBusinessOutcomeAdapter('acme/customer-app', targetPath)).toBeNull();
  });

  it('proves the reviewed patch recovers the real demo provisioning outcome', () => {
    const proof = proveBusinessOutcomeRepair({
      files: { [targetPath]: originalSource },
      targetPath,
      changes: DEMO_SAAS_PROVISIONING_REPAIR,
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
      changes: DEMO_SAAS_PROVISIONING_REPAIR,
      load: loadDemoHandler,
      createState: createUsers,
      run: (handler, users) => handler(users, 'cus_target', true),
      reproducesFailure: result => !result.success,
      provesRecovery: result => result.success,
    })).toThrow(/missing-before/);
  });
});
