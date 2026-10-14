// Learns the shape of each Stripe webhook event type and spots the changes that
// silently break provisioning code: a field that was always there disappears
// (e.g. moved by an API version upgrade) or changes type (an id string becomes
// an expanded object). Pure functions; stripe-changes.ts persists the state.
//
// Only field names and value kinds are kept, never values.

export type ValueKind = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';
type NonNullKind = Exclude<ValueKind, 'null'>;

export type PathStats = {
  /** events where the key existed (any value, including null) */
  present: number;
  /** events where the parent object existed but the key did not */
  missing: number;
  /** counts of non-null value kinds */
  kinds: Partial<Record<NonNullKind, number>>;
};
export type ShapeState = { samples: number; paths: Record<string, PathStats> };

export type ShapeChange =
  | { kind: 'FIELD_REMOVED'; path: string; before: NonNullKind }
  | { kind: 'TYPE_CHANGED'; path: string; before: NonNullKind; after: NonNullKind };

const ROOT = 'data.object';
const MAX_DEPTH = 6;
const MAX_PATHS = 600;
/** A field is "established" after this many events always containing it with one kind. */
export const MIN_SAMPLES = 5;
// Customer-defined or request-specific content; its keys are not part of Stripe's contract.
const SKIP_KEYS = new Set(['metadata']);

export function emptyShape(): ShapeState {
  return { samples: 0, paths: {} };
}

function kindOf(value: unknown): ValueKind {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return type;
  return 'object';
}

/**
 * Every field path under `data.object` with its value kind. Arrays are walked
 * through their first element as `path[]`. Values are not retained.
 */
export function flattenShape(event: unknown): Map<string, ValueKind> {
  const shape = new Map<string, ValueKind>();
  const data = (event as { data?: { object?: unknown } } | null)?.data;
  const root = data?.object;
  if (kindOf(root) !== 'object') return shape;

  const walk = (value: unknown, path: string, depth: number) => {
    const kind = kindOf(value);
    if (path !== ROOT) shape.set(path, kind);
    if (shape.size >= MAX_PATHS || depth >= MAX_DEPTH) return;
    if (kind === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (shape.size >= MAX_PATHS) return;
        const childPath = `${path}.${key}`;
        if (SKIP_KEYS.has(key)) {
          shape.set(childPath, kindOf(child));
          continue;
        }
        walk(child, childPath, depth + 1);
      }
    } else if (kind === 'array') {
      const first = (value as unknown[]).find(item => kindOf(item) !== 'null');
      if (first !== undefined) walk(first, `${path}[]`, depth + 1);
    }
  };
  walk(root, ROOT, 0);
  return shape;
}

function parentOf(path: string): string {
  if (path.endsWith('[]')) return path.slice(0, -2);
  return path.slice(0, path.lastIndexOf('.'));
}

/** Was the container that should hold `path` present (as an object) in this event? */
function parentPresent(path: string, shape: Map<string, ValueKind>): boolean {
  const parent = parentOf(path);
  if (parent === ROOT) return true;
  return shape.get(parent) === 'object';
}

/** The single non-null kind a field has always had, once it is established. */
function establishedKind(stats: PathStats): NonNullKind | null {
  if (stats.present < MIN_SAMPLES || stats.missing > 0) return null;
  const kinds = Object.entries(stats.kinds) as Array<[NonNullKind, number]>;
  if (kinds.length !== 1) return null;
  const [kind, count] = kinds[0];
  return count >= MIN_SAMPLES ? kind : null;
}

/**
 * Compare one event with what has been learned, then learn from it.
 * Returns the new state and the breaking-looking changes in this event. A
 * field reported once stops being "established", so it is never reported twice.
 */
export function observeShape(state: ShapeState, shape: Map<string, ValueKind>): { state: ShapeState; changes: ShapeChange[] } {
  const changes: ShapeChange[] = [];
  const paths: Record<string, PathStats> = {};
  for (const [path, stats] of Object.entries(state.paths)) paths[path] = { ...stats, kinds: { ...stats.kinds } };

  for (const [path, stats] of Object.entries(paths)) {
    const before = establishedKind(stats);
    const now = shape.get(path);
    if (now === undefined) {
      if (!parentPresent(path, shape)) continue;
      if (before) changes.push({ kind: 'FIELD_REMOVED', path, before });
      stats.missing++;
    } else if (before && now !== 'null' && now !== before) {
      changes.push({ kind: 'TYPE_CHANGED', path, before, after: now });
    }
  }

  let tracked = Object.keys(paths).length;
  for (const [path, kind] of shape) {
    let stats = paths[path];
    if (!stats) {
      if (tracked >= MAX_PATHS) continue;
      stats = paths[path] = { present: 0, missing: 0, kinds: {} };
      tracked++;
    }
    stats.present++;
    if (kind !== 'null') stats.kinds[kind] = (stats.kinds[kind] ?? 0) + 1;
  }

  // Drop changes inside a removed or retyped parent: report the top-most field only.
  const reported = changes.filter(change =>
    !changes.some(other => other !== change && (change.path.startsWith(`${other.path}.`) || change.path.startsWith(`${other.path}[]`))));
  return { state: { samples: state.samples + 1, paths }, changes: reported };
}

/** Stripe versions look like 2024-06-20 or 2025-03-31.basil. */
export function isNewerApiVersion(current: string, previous: string): boolean {
  if (current === previous) return false;
  const date = (version: string) => version.slice(0, 10);
  if (date(current) !== date(previous)) return date(current) > date(previous);
  return true;
}

/** Binding paths use dots for array indexes (lines.data.0.price); shapes use []. */
export function normalizeBindingPath(path: string): string {
  return path.replace(/\.\d+(?=\.|$)/g, '[]');
}

/** Does a change at `changedPath` touch a value read from `bindingPath`? */
export function pathsOverlap(changedPath: string, bindingPath: string): boolean {
  const binding = normalizeBindingPath(bindingPath);
  const startsWith = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[]`);
  return startsWith(binding, changedPath) || startsWith(changedPath, binding);
}
