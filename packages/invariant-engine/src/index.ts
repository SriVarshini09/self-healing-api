// @shapi/invariant-engine - Behavioral invariant evaluation
// Core abstraction: a 200 OK does not prove success.
// Invariants assert expected BUSINESS outcomes from third-party events.
//
// Predicates run as plain JavaScript inside a node:vm sandbox with a minimal
// `event` global and a 100ms timeout — never with host-scope `new Function`.
// (For untrusted multi-tenant input, prefer isolated-vm; this sandbox is the
// MVP hardening step over raw eval.)
import vm from 'node:vm';

export interface InvariantEvent {
  type: string;
  payload: Record<string, unknown>;
  headers: Record<string, unknown>;
}

export interface EvaluationWindow {
  totalSamples: number;
  passedSamples: number;
  successRate: number;
}

export type InvariantHealth = 'healthy' | 'degraded' | 'violated' | 'unknown';

const DANGEROUS = [
  /require\s*\(/,
  /import\s*\(/,
  /eval\s*\(/,
  /process\./,
  /child_process/,
  /\bas\s+(any|unknown|string|number|boolean)\b/,
];

export function validatePredicate(expression: string): void {
  if (!expression || !expression.trim()) throw new Error('Predicate expression is empty');
  for (const p of DANGEROUS) {
    if (p.test(expression)) throw new Error(`Dangerous pattern: ${p.source}`);
  }
  try {
    // Syntax-check inside vm — never `new Function` in host scope.
    new vm.Script(`result = (${expression});`);
  } catch (e) {
    throw new Error(`Invalid predicate syntax: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const EVAL_TIMEOUT_MS = 100;

export function evaluatePredicate(
  expression: string,
  event: InvariantEvent,
): { passed: boolean; error?: string } {
  try {
    validatePredicate(expression);
    // Deep-clone the event so predicates cannot mutate caller state, and so
    // the value crossing into the vm context is plain data.
    const eventCopy = JSON.parse(JSON.stringify(event ?? {}));
    const sandbox: Record<string, unknown> = { event: eventCopy, result: undefined };
    vm.createContext(sandbox);
    const script = new vm.Script(`result = (${expression});`);
    script.runInContext(sandbox, { timeout: EVAL_TIMEOUT_MS });
    return { passed: Boolean(sandbox.result) };
  } catch (e) {
    return { passed: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function evaluateWindow(
  expression: string,
  events: InvariantEvent[],
): EvaluationWindow & { results: boolean[] } {
  const results = events.map(ev => evaluatePredicate(expression, ev).passed);
  const passedSamples = results.filter(Boolean).length;
  const totalSamples = events.length;
  return {
    totalSamples,
    passedSamples,
    successRate: totalSamples === 0 ? 1 : passedSamples / totalSamples,
    results,
  };
}

/**
 * Event types a predicate scopes itself to, extracted from
 * `event.type === '...'` literals. Empty = applies to all events.
 */
export function extractPredicateEventTypes(expression: string): string[] {
  const types = new Set<string>();
  const re = /event\.type\s*===\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expression)) !== null) types.add(m[1]);
  return [...types];
}

/**
 * An event is relevant to a predicate when the predicate either scopes to no
 * specific type, or scopes to a set containing this event's type. Evaluating
 * irrelevant events would manufacture false violations (e.g. a payment webhook
 * failing a subscription predicate).
 */
export function isRelevantEvent(expression: string, eventType: string): boolean {
  const scoped = extractPredicateEventTypes(expression);
  return scoped.length === 0 || scoped.includes(eventType);
}

export function determineHealth(
  successRate: number,
  expectedRate: number,
  totalSamples: number,
  minSamples: number,
): InvariantHealth {
  if (totalSamples < minSamples) return 'unknown';
  if (successRate >= expectedRate) return 'healthy';
  if (successRate >= expectedRate * 0.9) return 'degraded';
  return 'violated';
}

// Pre-built Stripe invariants used by seed + demo SaaS
// NOTE: predicates run as plain JavaScript inside a node:vm sandbox.
// Do NOT use TypeScript syntax (no `as any` casts) here.
export const STRIPE_INVARIANTS = [
  {
    name: 'Payment Succeeded Invariant',
    description: 'invoice.payment_succeeded must have amount_paid > 0 and paid status',
    predicateExpression:
      "event.type === 'invoice.payment_succeeded' && event.payload && event.payload.data && event.payload.data.object && event.payload.data.object.amount_paid > 0",
    predicateDescription: 'Successful payments have positive amount',
  },
  {
    name: 'Provisioning Invariant',
    description: 'Payment success must lead to user provisioning (business outcome)',
    predicateExpression:
      "event.type === 'provisioning.completed' && event.payload && event.payload.userId !== undefined && event.payload.plan !== undefined",
    predicateDescription: 'Every paid invoice provisions the user',
  },
];
