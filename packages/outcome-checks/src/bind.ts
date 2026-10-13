// Bind outcome-query parameters from a provider event payload.
//
// Bindings map a query parameter to a dot path inside the event, e.g.
// { customer: 'data.object.customer' } for a Stripe invoice event.

export type ParamBindings = Record<string, string>;
export type ParamValue = string | number | boolean | null;

export class OutcomeBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutcomeBindingError';
  }
}

const PATH_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/;

export function resolvePath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Check that bindings cover exactly the parameters the query uses. */
export function validateBindings(paramNames: string[], bindings: ParamBindings): void {
  for (const [name, path] of Object.entries(bindings)) {
    if (!PATH_PATTERN.test(path)) throw new OutcomeBindingError(`Binding "${name}" has an invalid path: ${path}`);
  }
  const missing = paramNames.filter(name => !(name in bindings));
  if (missing.length) throw new OutcomeBindingError(`No binding for parameter(s): ${missing.join(', ')}`);
  const unused = Object.keys(bindings).filter(name => !paramNames.includes(name));
  if (unused.length) throw new OutcomeBindingError(`Binding(s) not used by the query: ${unused.join(', ')}`);
}

/**
 * Resolve every parameter, in placeholder order. A missing or non-scalar
 * value is an error: running the query with NULL would silently "fail" the
 * outcome and page someone for a bad binding.
 */
export function bindParams(names: string[], bindings: ParamBindings, payload: unknown): ParamValue[] {
  return names.map(name => {
    const path = bindings[name];
    if (!path) throw new OutcomeBindingError(`No binding for parameter "${name}"`);
    const value = resolvePath(payload, path);
    if (value === undefined || value === null) {
      throw new OutcomeBindingError(`Event has no value at "${path}" for parameter "${name}"`);
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    throw new OutcomeBindingError(`Value at "${path}" for parameter "${name}" is not a scalar`);
  });
}
