import { describe, expect, it } from 'vitest';
import {
  MIN_SAMPLES,
  emptyShape,
  flattenShape,
  isNewerApiVersion,
  normalizeBindingPath,
  observeShape,
  pathsOverlap,
  type ShapeState,
} from './stripe-shape.js';

// Modeled on Stripe's 2025-03-31.basil invoice change: invoice.subscription moved
// to invoice.parent.subscription_details.subscription.
function invoiceBefore(n: number) {
  return {
    id: `evt_${n}`, type: 'invoice.payment_succeeded', api_version: '2024-06-20',
    data: { object: {
      id: `in_${n}`, object: 'invoice', customer: `cus_${n}`, subscription: `sub_${n}`, amount_paid: 4900,
      discount: n % 2 ? null : { coupon: { id: 'c1' } },
      metadata: { [`order_${n}`]: 'x' },
      lines: { object: 'list', data: [{ id: `il_${n}`, price: { id: 'price_1', product: 'prod_1' } }] },
    } },
  };
}
function invoiceAfter(n: number) {
  const { subscription, ...object } = invoiceBefore(n).data.object;
  return {
    ...invoiceBefore(n), api_version: '2025-03-31.basil',
    data: { object: { ...object, parent: { subscription_details: { subscription } } } },
  };
}

function learn(events: unknown[], state: ShapeState = emptyShape()) {
  const changes = [];
  for (const event of events) {
    const result = observeShape(state, flattenShape(event));
    state = result.state;
    changes.push(...result.changes);
  }
  return { state, changes };
}

describe('flattenShape', () => {
  it('records field paths and kinds under data.object, never values', () => {
    const shape = flattenShape(invoiceBefore(0));
    expect(shape.get('data.object.subscription')).toBe('string');
    expect(shape.get('data.object.amount_paid')).toBe('number');
    expect(shape.get('data.object.lines.data')).toBe('array');
    expect(shape.get('data.object.lines.data[].price.product')).toBe('string');
    expect(shape.get('data.object.discount.coupon.id')).toBe('string');
    // metadata keys are the customer's own, so they are not walked
    expect(shape.get('data.object.metadata')).toBe('object');
    expect([...shape.keys()].some(path => path.includes('order_'))).toBe(false);
    expect(JSON.stringify([...shape])).not.toContain('cus_0');
  });

  it('handles non-objects and caps depth', () => {
    expect(flattenShape(null).size).toBe(0);
    expect(flattenShape({ data: { object: 'x' } }).size).toBe(0);
    const deep = { data: { object: { a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } } } };
    expect([...flattenShape(deep).keys()].every(path => path.split('.').length <= 8)).toBe(true);
  });
});

describe('observeShape', () => {
  it('reports a field that was always present and then disappears, once', () => {
    const { state } = learn(Array.from({ length: MIN_SAMPLES }, (_, n) => invoiceBefore(n)));
    const after = learn([invoiceAfter(10), invoiceAfter(11), invoiceAfter(12)], state);
    expect(after.changes).toEqual([{ kind: 'FIELD_REMOVED', path: 'data.object.subscription', before: 'string' }]);
  });

  it('reports a type change (id string -> expanded object) but not its new children', () => {
    const base = Array.from({ length: MIN_SAMPLES }, (_, n) => invoiceBefore(n));
    const { state } = learn(base);
    const expanded = invoiceBefore(9);
    (expanded.data.object as Record<string, unknown>).customer = { id: 'cus_9', email: null };
    expect(learn([expanded], state).changes).toEqual([
      { kind: 'TYPE_CHANGED', path: 'data.object.customer', before: 'string', after: 'object' },
    ]);
  });

  it('stays quiet before a field is established, for nullable fields, and for new fields', () => {
    const early = learn([invoiceBefore(0), invoiceBefore(1), invoiceAfter(2)]);
    expect(early.changes).toEqual([]);
    // discount alternates between null and an object: children only count when the parent exists
    const { state } = learn(Array.from({ length: 12 }, (_, n) => invoiceBefore(n)));
    expect(learn([invoiceBefore(13), invoiceBefore(14)], state).changes).toEqual([]);
    // new fields (parent.*) are additions, not breaking
    expect(learn([invoiceAfter(20)], state).changes.every(change => !change.path.startsWith('data.object.parent'))).toBe(true);
  });

  it('a removed parent is reported once, not each of its children', () => {
    const { state } = learn(Array.from({ length: MIN_SAMPLES }, (_, n) => invoiceBefore(n * 2)));
    const noLines = invoiceBefore(99);
    delete (noLines.data.object as Record<string, unknown>).lines;
    expect(learn([noLines], state).changes).toEqual([{ kind: 'FIELD_REMOVED', path: 'data.object.lines', before: 'object' }]);
  });

  it('keeps learning without values and caps tracked paths', () => {
    const wide = { data: { object: Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`f${i}`, i])) } };
    const { state } = learn([wide]);
    expect(Object.keys(state.paths).length).toBeLessThanOrEqual(600);
    expect(state.samples).toBe(1);
  });
});

describe('versions and bindings', () => {
  it('orders Stripe API versions by date', () => {
    expect(isNewerApiVersion('2025-03-31.basil', '2024-06-20')).toBe(true);
    expect(isNewerApiVersion('2024-06-20', '2025-03-31.basil')).toBe(false); // late retry of an old event
    expect(isNewerApiVersion('2024-06-20', '2024-06-20')).toBe(false);
    expect(isNewerApiVersion('2025-03-31.basil', '2025-03-31.preview')).toBe(true);
  });

  it('matches a change to the values an outcome check reads', () => {
    expect(normalizeBindingPath('data.object.lines.data.0.price.id')).toBe('data.object.lines.data[].price.id');
    expect(pathsOverlap('data.object.subscription', 'data.object.subscription')).toBe(true);
    expect(pathsOverlap('data.object.lines', 'data.object.lines.data.0.price.id')).toBe(true);
    expect(pathsOverlap('data.object.customer.id', 'data.object.customer')).toBe(true);
    expect(pathsOverlap('data.object.subscription', 'data.object.subscription_details')).toBe(false);
    expect(pathsOverlap('data.object.amount_paid', 'data.object.customer')).toBe(false);
  });
});
