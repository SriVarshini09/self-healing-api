// @shapi/invariant-engine - Behavioral invariant evaluation
// Core abstraction: a 200 OK does not prove success.
// Invariants assert expected BUSINESS outcomes from third-party events.
//
// Predicates run inside an isolated-vm V8 isolate with a minimal `event`
// global, a memory cap, and a 100ms timeout. The node:vm implementation is
// retained only as an explicit local-development fallback when the native
// optional dependency cannot be built on a developer workstation.
import vm from 'node:vm';
import { createRequire } from 'node:module';

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
  /Function\s*\(/,
  /constructor\s*\(/,
  /process\./,
  /child_process/,
  /\bas\s+(any|unknown|string|number|boolean)\b/,
];

export function validatePredicate(expression: string): void {
  if (!expression || !expression.trim()) throw new Error('Predicate expression is empty');
  if (expression.length > 4096) throw new Error('Predicate expression exceeds 4096 characters');
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
const ISOLATE_MEMORY_LIMIT_MB = 32;

type IsolatedVmContext = {
  global: {
    setSync: (name: string, value: unknown, options: { copy: true }) => void;
  };
  release: () => void;
};

type IsolatedVmModule = {
  Isolate: new (options: {
    memoryLimit: number;
    onCatastrophicError?: (message: string) => void;
  }) => {
    createContextSync: () => IsolatedVmContext;
    compileScriptSync: (source: string) => {
      runSync: (context: IsolatedVmContext, options: { timeout: number; copy: true }) => unknown;
      release?: () => void;
    };
    dispose: () => void;
  };
};

const nodeRequire = createRequire(__filename);
let isolatedVm: IsolatedVmModule | null | undefined;

function requiresIsolatedVm(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.SHAPI_REQUIRE_ISOLATED_VM === 'true';
}

function loadIsolatedVm(): IsolatedVmModule | null {
  if (isolatedVm !== undefined) return isolatedVm;

  try {
    const loaded = nodeRequire('isolated-vm') as IsolatedVmModule;
    if (!loaded?.Isolate) throw new Error('isolated-vm did not expose Isolate');
    isolatedVm = loaded;
  } catch (error) {
    if (requiresIsolatedVm()) {
      throw new Error(
        `isolated-vm is required for predicate evaluation in this environment: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    isolatedVm = null;
  }

  return isolatedVm;
}

function evaluateWithIsolatedVm(
  expression: string,
  eventCopy: InvariantEvent,
  ivm: IsolatedVmModule,
): boolean {
  const isolate = new ivm.Isolate({ memoryLimit: ISOLATE_MEMORY_LIMIT_MB });
  const context = isolate.createContextSync();
  try {
    context.global.setSync('event', eventCopy, { copy: true });
    const script = isolate.compileScriptSync(`(${expression})`);
    try {
      return Boolean(script.runSync(context, { timeout: EVAL_TIMEOUT_MS, copy: true }));
    } finally {
      script.release?.();
    }
  } finally {
    context.release();
    isolate.dispose();
  }
}

export function evaluatePredicate(
  expression: string,
  event: InvariantEvent,
): { passed: boolean; error?: string } {
  try {
    validatePredicate(expression);
    // Deep-clone the event so predicates cannot mutate caller state, and so
    // the value crossing into the vm context is plain data.
    const eventCopy = JSON.parse(JSON.stringify(event ?? {}));
    const ivm = loadIsolatedVm();
    if (ivm) {
      return { passed: evaluateWithIsolatedVm(expression, eventCopy, ivm) };
    }

    // This path is intentionally unavailable in production. It keeps local
    // tests and development usable on Windows machines without node-gyp while
    // Docker/CI enforce the isolated-vm runtime.
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
// NOTE: predicates run in isolated-vm; do NOT use TypeScript syntax here.
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
