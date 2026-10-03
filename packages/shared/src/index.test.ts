import { describe, expect, it } from 'vitest';
import {
  IncidentSeveritySchema,
  IncidentStatusSchema,
  IntegrationTypeSchema,
  InvariantStatusSchema,
  WebhookEventSchema,
  WebhookEventStatusSchema,
} from './index';

describe('domain enums', () => {
  it('accepts known integration types', () => {
    expect(IntegrationTypeSchema.parse('stripe')).toBe('stripe');
    expect(() => IntegrationTypeSchema.parse('unknown')).toThrow();
  });

  it('accepts webhook lifecycle statuses', () => {
    expect(WebhookEventStatusSchema.parse('received')).toBe('received');
    expect(WebhookEventStatusSchema.parse('completed')).toBe('completed');
    expect(() => WebhookEventStatusSchema.parse('nope')).toThrow();
  });

  it('accepts invariant health states', () => {
    expect(InvariantStatusSchema.parse('healthy')).toBe('healthy');
    expect(() => InvariantStatusSchema.parse('broken')).toThrow();
  });

  it('accepts incident severity and lifecycle', () => {
    expect(IncidentSeveritySchema.parse('high')).toBe('high');
    expect(IncidentStatusSchema.parse('detected')).toBe('detected');
    expect(IncidentStatusSchema.parse('resolved')).toBe('resolved');
    expect(() => IncidentStatusSchema.parse('closed')).toThrow();
  });
});

describe('WebhookEventSchema', () => {
  it('parses a valid webhook event', () => {
    const event = WebhookEventSchema.parse({
      id: '123e4567-e89b-12d3-a456-426614174000',
      integrationId: '123e4567-e89b-12d3-a456-426614174001',
      integrationType: 'stripe',
      eventType: 'invoice.payment_succeeded',
      payload: { amount: 2000 },
      headers: { 'stripe-signature': 'test' },
      status: 'received',
      receivedAt: new Date(),
      processedAt: null,
      errorMessage: null,
      correlationId: null,
    });
    expect(event.retryCount).toBe(0);
    expect(event.eventType).toBe('invoice.payment_succeeded');
  });

  it('rejects invalid payloads', () => {
    expect(() =>
      WebhookEventSchema.parse({
        id: 'not-a-uuid',
        integrationId: '123e4567-e89b-12d3-a456-426614174001',
        integrationType: 'stripe',
        eventType: 'x',
        payload: {},
        headers: {},
        status: 'received',
        receivedAt: new Date(),
        processedAt: null,
        errorMessage: null,
        correlationId: null,
      }),
    ).toThrow();
  });
});
