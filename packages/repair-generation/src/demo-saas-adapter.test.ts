import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import {
  DEMO_SAAS_PROVISIONING_ADAPTER_ID,
  DEMO_SAAS_PROVISIONING_PATH,
  DEMO_SAAS_PROVISIONING_REPAIR,
  DEMO_SAAS_SUBSCRIPTION_ADAPTER_ID,
  DEMO_SAAS_SUBSCRIPTION_PATH,
  DEMO_SAAS_SUBSCRIPTION_REPAIR,
  REVIEWED_BUSINESS_OUTCOME_ADAPTERS,
  reviewedBusinessOutcomeAdapter,
  proveBusinessOutcomeRepair,
  validateReviewedBusinessOutcomeAdapters,
} from './index.js';

type DemoUser = {
  id: string;
  email: string;
  plan: string;
  provisioned: boolean;
  subscriptionActive: boolean;
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

function loadSubscriptionHandler(source: string): DemoHandler {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: 'subscription-outcome.ts',
  }).outputText;
  const module: { exports: Record<string, unknown> } = { exports: {} };
  new Function('exports', 'require', 'module', '__filename', '__dirname', compiled)(
    module.exports,
    undefined,
    module,
    'subscription-outcome.ts',
    process.cwd(),
  );
  return module.exports.applySubscriptionActivationOutcome as DemoHandler;
}

function createUsers() {
  return new Map<string, DemoUser>([
    ['cus_target', {
      id: 'cus_target',
      email: 'target@example.com',
      plan: 'pro',
      provisioned: false,
      subscriptionActive: false,
    }],
  ]);
}

describe('real demo-saas business-outcome adapter', () => {
  it('validates the reviewed adapter catalog', () => {
    expect(() => validateReviewedBusinessOutcomeAdapters(REVIEWED_BUSINESS_OUTCOME_ADAPTERS)).not.toThrow();
  });

  it('fails closed when a reviewed adapter does not change its declared target', () => {
    const broken = {
      ...REVIEWED_BUSINESS_OUTCOME_ADAPTERS[0],
      repair: {
        ...REVIEWED_BUSINESS_OUTCOME_ADAPTERS[0].repair,
        changes: [{ ...DEMO_SAAS_PROVISIONING_REPAIR[0], path: 'src/other.ts' }],
      },
    };

    expect(() => validateReviewedBusinessOutcomeAdapters([broken])).toThrow(/declared target file/);
  });

  it('fails closed for duplicate reviewed targets', () => {
    expect(() => validateReviewedBusinessOutcomeAdapters([
      ...REVIEWED_BUSINESS_OUTCOME_ADAPTERS,
      { ...REVIEWED_BUSINESS_OUTCOME_ADAPTERS[0], adapterId: 'duplicate-target' },
    ])).toThrow(/must be unique/);
  });

  it('exposes explicit reviewed adapter metadata', () => {
    expect(reviewedBusinessOutcomeAdapter('SriVarshini09/self-healing-api', targetPath)).toMatchObject({
      adapterId: DEMO_SAAS_PROVISIONING_ADAPTER_ID,
      requiredCheck: 'business-outcome',
      repair: {
        confidence: 0.95,
        changes: [{ kind: 'replace', path: targetPath }],
      },
    });
    expect(reviewedBusinessOutcomeAdapter('SriVarshini09/self-healing-api', DEMO_SAAS_SUBSCRIPTION_PATH)).toMatchObject({
      adapterId: DEMO_SAAS_SUBSCRIPTION_ADAPTER_ID,
      requiredCheck: 'business-outcome',
      repair: {
        confidence: 0.94,
        changes: [{ kind: 'replace', path: DEMO_SAAS_SUBSCRIPTION_PATH }],
      },
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

  it('proves the reviewed subscription adapter recovers activation', () => {
    const targetFile = path.resolve(process.cwd(), '../../apps/demo-saas/src/subscription-outcome.ts');
    const source = readFileSync(targetFile, 'utf8');
    const proof = proveBusinessOutcomeRepair({
      files: { [DEMO_SAAS_SUBSCRIPTION_PATH]: source },
      targetPath: DEMO_SAAS_SUBSCRIPTION_PATH,
      changes: DEMO_SAAS_SUBSCRIPTION_REPAIR,
      load: loadSubscriptionHandler,
      createState: () => new Map<string, DemoUser>([
        ['cus_subscription', {
          id: 'cus_subscription',
          email: 'subscription@example.com',
          plan: 'pro',
          provisioned: true,
          subscriptionActive: false,
        }],
      ]),
      run: (handler, users) => handler(users, 'cus_subscription', true),
      reproducesFailure: (result, users) => !result.success && users.get('cus_subscription')?.subscriptionActive === false,
      provesRecovery: (result, users) => result.success && users.get('cus_subscription')?.subscriptionActive === true,
    });

    expect(proof.before.result.success).toBe(false);
    expect(proof.after.result.success).toBe(true);
    expect(proof.after.state.get('cus_subscription')?.subscriptionActive).toBe(true);
  });
});
