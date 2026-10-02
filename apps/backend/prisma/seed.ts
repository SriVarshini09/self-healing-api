import { PrismaClient, IntegrationType, InvariantStatus, TenantRole } from '@prisma/client';
import {
  GITHUB_PR_MERGED_PREDICATE,
  GITHUB_WORKFLOW_SUCCESS_PREDICATE,
} from '../src/services/github-invariants.js';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  const localTenant = await prisma.tenant.upsert({
    where: { id: 'tenant-local-dev' },
    update: { name: 'Local Development', slug: 'local-dev' },
    create: { id: 'tenant-local-dev', name: 'Local Development', slug: 'local-dev' },
  });

  // Create Stripe integration
  const stripeIntegration = await prisma.integration.upsert({
    where: { id: 'stripe-demo' },
    update: { tenantId: localTenant.id },
    create: {
      id: 'stripe-demo',
      tenantId: localTenant.id,
      name: 'Stripe Payments',
      type: IntegrationType.STRIPE,
      config: {
        apiVersion: '2023-10-16',
        webhookRetryPolicy: 'exponential'
      },
      webhookSecret: 'whsec_demo_secret_1234567890abcdef',
      webhookEnabled: true
    }
  });

  console.log('✅ Created Stripe integration:', stripeIntegration.id);

  // Create GitHub integration
  const githubIntegration = await prisma.integration.upsert({
    where: { id: 'github-demo' },
    update: { tenantId: localTenant.id },
    create: {
      id: 'github-demo',
      tenantId: localTenant.id,
      name: 'GitHub App',
      type: IntegrationType.GITHUB,
      config: {
        permissions: {
          contents: 'read',
          pull_requests: 'write',
          metadata: 'read'
        }
      },
      webhookSecret: 'ghwebhook_demo_secret_1234567890abcdef',
      webhookEnabled: true
    }
  });

  console.log('✅ Created GitHub integration:', githubIntegration.id);

  // Create invariants for Stripe
  const stripeInvariants = [
    {
      id: 'inv-stripe-payment-succeeded',
      integrationId: stripeIntegration.id,
      name: 'Payment Succeeded Invariant',
      description: 'Invoice payment succeeded events should have amount_paid > 0 and status = paid',
      predicateExpression: "event.type === 'invoice.payment_succeeded' && event.payload && event.payload.data && event.payload.data.object && event.payload.data.object.amount_paid > 0 && event.payload.data.object.status === 'paid'",
      predicateDescription: 'Successful payments have positive amount and paid status',
      predicateExample: "event.type === 'invoice.payment_succeeded' && event.payload.data.object.amount_paid > 0",
      evaluationWindowSec: 300,
      minSamples: 10,
      expectedSuccessRate: 0.99,
      status: InvariantStatus.HEALTHY
    },
    {
      id: 'inv-stripe-subscription-active',
      integrationId: stripeIntegration.id,
      name: 'Subscription Active Invariant',
      description: 'Customer subscription created events should have status = active',
      predicateExpression: "event.type === 'customer.subscription.created' && event.payload && event.payload.data && event.payload.data.object && event.payload.data.object.status === 'active'",
      predicateDescription: 'New subscriptions should be active immediately',
      predicateExample: "event.type === 'customer.subscription.created' && event.payload.data.object.status === 'active'",
      evaluationWindowSec: 300,
      minSamples: 5,
      expectedSuccessRate: 0.95,
      status: InvariantStatus.HEALTHY
    },
    {
      id: 'inv-stripe-provisioning',
      integrationId: stripeIntegration.id,
      name: 'No Failed Provisioning Invariant',
      description: 'No provisioning.failed business outcome may occur — a 200 OK webhook that never provisions the user is a failure',
      predicateExpression: "event.type !== 'provisioning.failed'",
      predicateDescription: 'Every tracked business outcome must succeed',
      predicateExample: "event.type !== 'provisioning.failed'",
      evaluationWindowSec: 300,
      minSamples: 5,
      expectedSuccessRate: 0.99,
      status: InvariantStatus.HEALTHY
    },
    {
      id: 'inv-stripe-refund-succeeded',
      integrationId: stripeIntegration.id,
      name: 'Refund Succeeded Invariant',
      description: 'Refund succeeded events should have amount > 0 and status = succeeded',
      predicateExpression: "event.type === 'refund.succeeded' && event.payload && event.payload.data && event.payload.data.object && event.payload.data.object.amount > 0 && event.payload.data.object.status === 'succeeded'",
      predicateDescription: 'Successful refunds have positive amount and succeeded status',
      predicateExample: "event.type === 'refund.succeeded' && event.payload.data.object.amount > 0",
      evaluationWindowSec: 300,
      minSamples: 5,
      expectedSuccessRate: 0.99,
      status: InvariantStatus.HEALTHY
    }
  ];

  for (const inv of stripeInvariants) {
    await prisma.invariant.upsert({
      where: { id: inv.id },
      update: {},
      create: inv
    });
    console.log('✅ Created invariant:', inv.name);
  }

  // Create invariants for GitHub
  const githubInvariants = [
    {
      id: 'inv-github-pr-merged',
      integrationId: githubIntegration.id,
      name: 'PR Merged Invariant',
      description: 'Pull request merged events should have merged = true and base branch = main',
      predicateExpression: GITHUB_PR_MERGED_PREDICATE,
      predicateDescription: 'Merged PRs should be closed with merged=true targeting main',
      predicateExample: "event.type === 'pull_request' && event.payload.action === 'closed' && event.payload.pull_request.merged === true",
      evaluationWindowSec: 300,
      minSamples: 5,
      expectedSuccessRate: 0.99,
      status: InvariantStatus.HEALTHY
    },
    {
      id: 'inv-github-workflow-success',
      integrationId: githubIntegration.id,
      name: 'Workflow Success Invariant',
      description: 'Workflow run completed events should have conclusion = success',
      predicateExpression: GITHUB_WORKFLOW_SUCCESS_PREDICATE,
      predicateDescription: 'CI/CD workflows should complete successfully',
      predicateExample: "event.type === 'workflow_run' && event.payload.workflow_run.conclusion === 'success'",
      evaluationWindowSec: 600,
      minSamples: 10,
      expectedSuccessRate: 0.9,
      status: InvariantStatus.HEALTHY
    }
  ];

  for (const inv of githubInvariants) {
    await prisma.invariant.upsert({
      where: { id: inv.id },
      update: {},
      create: inv
    });
    console.log('✅ Created invariant:', inv.name);
  }

  // Create drift detection configs
  await prisma.driftDetectionConfig.upsert({
    where: { integrationId: stripeIntegration.id },
    update: {},
    create: {
      integrationId: stripeIntegration.id,
      baselineWindowDays: 30,
      detectionWindowHours: 1,
      minDetectionSamples: 50,
      significanceThreshold: 0.01,
      minEffectSize: 0.5,
      enabled: true
    }
  });

  await prisma.driftDetectionConfig.upsert({
    where: { integrationId: githubIntegration.id },
    update: {},
    create: {
      integrationId: githubIntegration.id,
      baselineWindowDays: 30,
      detectionWindowHours: 1,
      minDetectionSamples: 50,
      significanceThreshold: 0.01,
      minEffectSize: 0.5,
      enabled: true
    }
  });

  console.log('✅ Created drift detection configs');

  // Create sample webhook events
  const sampleEvents = [
    {
      integrationId: stripeIntegration.id,
      eventType: 'invoice.payment_succeeded',
      payload: {
        id: 'evt_123',
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            id: 'in_123',
            amount_paid: 2000,
            status: 'paid',
            currency: 'usd',
            customer: 'cus_123'
          }
        }
      },
      headers: { 'stripe-signature': 'sig_123' },
      status: 'COMPLETED',
      correlationId: 'corr_123'
    },
    {
      integrationId: stripeIntegration.id,
      eventType: 'customer.subscription.created',
      payload: {
        id: 'evt_124',
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_123',
            status: 'active',
            customer: 'cus_123',
            items: { data: [{ price: { id: 'price_123' } }] }
          }
        }
      },
      headers: { 'stripe-signature': 'sig_124' },
      status: 'COMPLETED',
      correlationId: 'corr_124'
    },
    {
      integrationId: githubIntegration.id,
      eventType: 'pull_request',
      payload: {
        action: 'closed',
        pull_request: {
          id: 123,
          number: 42,
          merged: true,
          base: { ref: 'main' },
          head: { ref: 'feature/new-feature' }
        }
      },
      headers: { 'x-github-event': 'pull_request' },
      status: 'COMPLETED',
      correlationId: 'corr_125'
    }
  ];

  for (const event of sampleEvents) {
    await prisma.webhookEvent.create({
      data: {
        ...event,
        receivedAt: new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000)
      }
    });
  }

  console.log('✅ Created sample webhook events');

  // Create sample evaluations
  for (const inv of [...stripeInvariants, ...githubInvariants]) {
    const now = new Date();
    for (let i = 0; i < 10; i++) {
      const windowStart = new Date(now.getTime() - (i + 1) * 5 * 60 * 1000);
      const windowEnd = new Date(now.getTime() - i * 5 * 60 * 1000);
      const totalSamples = Math.floor(Math.random() * 20) + 10;
      const passedSamples = Math.floor(totalSamples * (0.95 + Math.random() * 0.05));
      const successRate = passedSamples / totalSamples;
      const status = successRate >= 0.99 ? InvariantStatus.HEALTHY :
                     successRate >= 0.9 ? InvariantStatus.DEGRADED : InvariantStatus.VIOLATED;

      await prisma.invariantEvaluation.create({
        data: {
          invariantId: inv.id,
          windowStart,
          windowEnd,
          totalSamples,
          passedSamples,
          successRate,
          status
        }
      });
    }
  }

  console.log('✅ Created sample evaluations');

  // Fixed local-dev API key (dev only — documented in README/.env).
  // Must match DEMO_API_KEY in src/utils/api-keys.ts.
  const crypto = await import('crypto');
  const apiKey = process.env.SHAPI_API_KEY || 'shapi_demo_local_d3v_k3y_9f2c';
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

  await prisma.aPIKey.upsert({
    where: { keyHash },
    update: { tenantId: localTenant.id, permissions: ['*'], role: TenantRole.OWNER },
    create: {
      tenantId: localTenant.id,
      name: 'Local Dev Key',
      keyHash,
      prefix: 'shapi_',
      permissions: ['*'],
      role: TenantRole.OWNER,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    }
  });

  console.log('✅ Created demo API key');

  console.log('\n🎉 Seeding complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
