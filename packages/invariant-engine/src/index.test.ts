import { describe, it, expect } from 'vitest';
import { validatePredicate, evaluatePredicate, evaluateWindow, determineHealth, isRelevantEvent, extractPredicateEventTypes } from './index.js';

describe('invariant-engine', () => {
  it('validates good predicate', () => {
    expect(() =>
      validatePredicate("event.type === 'invoice.payment_succeeded'"),
    ).not.toThrow();
  });

  it('rejects dangerous predicate', () => {
    expect(() => validatePredicate('process.env.SECRET')).toThrow();
    expect(() => validatePredicate('require("fs")')).toThrow();
  });

  it('rejects oversized predicate expressions before execution', () => {
    expect(() => validatePredicate(`true /*${'x'.repeat(4096)}*/`)).toThrow(/4096 characters/);
  });

  it('200 OK does not prove success - payload must satisfy business outcome', () => {
    // Technically healthy webhook (HTTP 200) but business outcome failed:
    // amount_paid = 0 means no real payment, provisioning missing
    const expr = "event.type === 'invoice.payment_succeeded' && event.payload.amount_paid > 0";
    const ok = evaluatePredicate(expr, {
      type: 'invoice.payment_succeeded',
      payload: { amount_paid: 2000 },
      headers: {},
    });
    const bad = evaluatePredicate(expr, {
      type: 'invoice.payment_succeeded',
      payload: { amount_paid: 0 },
      headers: {},
    });
    expect(ok.passed).toBe(true);
    expect(bad.passed).toBe(false);
  });

  it('runs predicates in a sandbox without host globals', () => {
    const ev = { type: 't', payload: { ok: true }, headers: {} };
    // process / require / globalThis must not leak into the sandbox
    expect(evaluatePredicate('typeof process === "undefined"', ev).passed).toBe(true);
    expect(evaluatePredicate('typeof require === "undefined"', ev).passed).toBe(true);
    expect(evaluatePredicate('event.payload.ok === true', ev).passed).toBe(true);
  });

  it('times out infinite loops instead of hanging', () => {
    const ev = { type: 't', payload: {}, headers: {} };
    const start = Date.now();
    const r = evaluatePredicate('(() => { while (true) {} return true; })()', ev);
    expect(r.passed).toBe(false);
    expect(r.error).toMatch(/timed out/i);
    expect(Date.now() - start).toBeLessThan(5000);
  });

  it('does not mutate the caller event object', () => {
    const ev = { type: 't', payload: { n: 1 }, headers: {} };
    evaluatePredicate('event.payload.n = 999', ev);
    expect(ev.payload.n).toBe(1);
  });

  it('scopes evaluation to relevant event types', () => {
    const expr = "event.type === 'invoice.payment_succeeded' && event.payload.amount_paid > 0";
    expect(isRelevantEvent(expr, 'invoice.payment_succeeded')).toBe(true);
    expect(isRelevantEvent(expr, 'customer.subscription.created')).toBe(false);
    expect(isRelevantEvent('event.payload.ok === true', 'anything.at.all')).toBe(true);
    expect(extractPredicateEventTypes(expr)).toEqual(['invoice.payment_succeeded']);
  });

  it('evaluates window + health', () => {
    const expr = 'event.payload.ok === true';
    const w = evaluateWindow(expr, [
      { type: 't', payload: { ok: true }, headers: {} },
      { type: 't', payload: { ok: false }, headers: {} },
      { type: 't', payload: { ok: true }, headers: {} },
    ]);
    expect(w.totalSamples).toBe(3);
    expect(w.passedSamples).toBe(2);
    expect(determineHealth(w.successRate, 0.99, 3, 2)).toBe('violated');
    expect(determineHealth(1, 0.99, 1, 10)).toBe('unknown');
    expect(determineHealth(1, 0.99, 20, 10)).toBe('healthy');
  });

  describe('sandbox boundary', () => {
    const run = (expression: string) => evaluatePredicate(expression, { type: 'x', payload: { a: 1 }, headers: {} });

    it('cannot reach the host process through the event object, even past the pattern list', () => {
      // These bypass the regex blocklist, so only the sandbox itself stops them.
      expect(run('event["constructor"]["constructor"]("return typeof process")() === "undefined"').passed).toBe(true);
      expect(run('event.payload["constructor"]["constructor"]("return typeof require")() === "undefined"').passed).toBe(true);
      expect(run('event["constructor"]["constructor"]("return typeof process")() === "object"').passed).toBe(false);
    });

    it('still evaluates normal predicates against the event', () => {
      expect(run("event.type === 'x' && event.payload.a === 1").passed).toBe(true);
      expect(run("event.payload.a === 2").passed).toBe(false);
    });

    it('refuses the obvious dangerous patterns and bad syntax', () => {
      expect(run('process.exit(1)').passed).toBe(false);
      expect(run('require("fs")').passed).toBe(false);
      expect(run('event.type ===').error).toMatch(/syntax/i);
    });

    it('cannot change the event for later evaluations', () => {
      const shared = { type: 'x', payload: { a: 1 }, headers: {} };
      evaluatePredicate('(event.payload.a = 99) === 99', shared);
      expect(shared.payload.a).toBe(1);
    });
  });
});
