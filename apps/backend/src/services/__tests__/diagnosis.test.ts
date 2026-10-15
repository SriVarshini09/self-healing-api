import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  check: null as Record<string, unknown> | null,
  failedRuns: [] as Array<Record<string, unknown>>,
  failedCount: 0,
  passedCount: 0,
  changes: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    outcomeCheck: { findUnique: async () => db.check },
    outcomeCheckRun: {
      findMany: async () => db.failedRuns,
      count: async ({ where }: { where: { status: string } }) => (where.status === 'FAILED' ? db.failedCount : db.passedCount),
    },
    stripeChange: { findMany: async () => db.changes },
  },
}));

const { diagnoseIncident } = await import('../diagnosis.js');

const detectedAt = new Date('2026-10-14T12:00:00Z');
const integration = { id: 'int-1', type: 'STRIPE' as const, tenantId: 't-1' };
function outcomeIncident() {
  return {
    id: 'inc-1', detectedAt, integrationId: 'int-1',
    invariant: { id: 'outcome-chk-1', name: 'Outcome: Paid customers', predicateDescription: '' },
    integration,
  } as unknown as Parameters<typeof diagnoseIncident>[0];
}

beforeEach(() => {
  db.check = { id: 'chk-1', integrationId: 'int-1', triggerEventType: 'invoice.payment_succeeded' };
  db.failedRuns = [
    { params: { customer: 'cus_stuck' }, sourceEventId: 'evt_2', detail: 'Outcome query returned no rows after the deadline' },
    { params: { customer: 'cus_other' }, sourceEventId: 'evt_1', detail: null },
  ];
  db.failedCount = 2;
  db.passedCount = 8;
  db.changes = [];
});

describe('outcome-check diagnosis', () => {
  it('names the event type, the failure ratio and the stuck customer', async () => {
    const result = await diagnoseIncident(outcomeIncident());
    expect(result.rootCause).toContain('2 of 10 invoice.payment_succeeded event(s)');
    expect(result.rootCause).toContain('customer cus_stuck');
    expect(result.suggestedFix).toContain('webhook handler for invoice.payment_succeeded');
    expect(result.suggestedFix).toContain('give the affected customers their access');
    expect(result.evidence[0]).toBe('customer cus_stuck · evt_2 · Outcome query returned no rows after the deadline');
    expect(result.confidence).toBe(0.85);
  });

  it('points at a Stripe change that touched a field the check reads', async () => {
    db.changes = [{
      kind: 'FIELD_REMOVED', path: 'data.object.subscription', before: 'string', after: null,
      detectedAt: new Date('2026-10-13T09:00:00Z'),
    }];
    const result = await diagnoseIncident(outcomeIncident());
    expect(result.rootCause).toContain('Stripe changed data.object.subscription on 2026-10-13');
    expect(result.suggestedFix).toContain('read the field where Stripe now sends it');
    expect(result.evidence).toContain('Stripe change: FIELD_REMOVED data.object.subscription string -> removed');
    expect(result.confidence).toBe(0.9);
  });

  it('says when every payment failed', async () => {
    db.passedCount = 0;
    expect((await diagnoseIncident(outcomeIncident())).rootCause).toContain('failing for everyone');
  });
});

describe('Stripe change diagnosis', () => {
  it('lists the version and field changes of an incident without a rule', async () => {
    db.changes = [
      { kind: 'API_VERSION', before: '2024-06-20', after: '2025-03-31.basil', path: null, eventType: 'invoice.paid', affectedCheckIds: [] },
      { kind: 'FIELD_REMOVED', before: 'string', after: null, path: 'data.object.subscription', eventType: 'invoice.paid', affectedCheckIds: ['chk-1'] },
    ];
    const result = await diagnoseIncident({ id: 'inc-2', detectedAt, invariant: null, integration } as unknown as Parameters<typeof diagnoseIncident>[0]);
    expect(result.rootCause).toBe('Stripe now sends webhooks with API version 2025-03-31.basil (was 2024-06-20). 1 field(s) changed: data.object.subscription (no longer sent).');
    expect(result.suggestedFix).toContain('update its bindings too');
    expect(result.evidence).toEqual(['API_VERSION · invoice.paid', 'FIELD_REMOVED · invoice.paid · data.object.subscription']);
  });
});
