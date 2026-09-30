// Structured repair changes: machine-applicable edits behind a repair candidate.
// A candidate keeps its human-readable diff/files fields; `changes` is the
// structured form a future applier (not replay, not the dashboard) can execute.

export interface ReplaceChange {
  kind: 'replace';
  /** repo-relative posix path, e.g. "src/invariants/pay.ts" */
  path: string;
  /** exact text that must occur exactly once in the file */
  before: string;
  /** replacement text */
  after: string;
}

export interface CreateChange {
  kind: 'create';
  /** repo-relative posix path of the file to create */
  path: string;
  /** full file content */
  content: string;
}

export type RepairChange = ReplaceChange | CreateChange;

export type RepairChangeErrorCode =
  | 'invalid-change'
  | 'unsafe-path'
  | 'duplicate-path'
  | 'missing-file'
  | 'missing-before'
  | 'ambiguous-before'
  | 'file-exists';

export class RepairChangeError extends Error {
  readonly code: RepairChangeErrorCode;
  readonly changeIndex: number;

  constructor(code: RepairChangeErrorCode, changeIndex: number, message: string) {
    super(`[${code}] change ${changeIndex}: ${message}`);
    this.name = 'RepairChangeError';
    this.code = code;
    this.changeIndex = changeIndex;
  }
}

function assertSafePath(path: unknown, index: number): asserts path is string {
  if (typeof path !== 'string' || path.trim() === '') {
    throw new RepairChangeError('unsafe-path', index, 'path must be a non-empty string');
  }
  if (path.includes('\\')) {
    throw new RepairChangeError('unsafe-path', index, `path must use posix separators: ${path}`);
  }
  if (path.startsWith('/') || /^[A-Za-z]:[\/]/.test(path)) {
    throw new RepairChangeError('unsafe-path', index, `absolute paths are rejected: ${path}`);
  }
  const segments = path.split('/');
  if (segments.some(s => s === '..' || s === '__proto__')) {
    throw new RepairChangeError('unsafe-path', index, `path traversal is rejected: ${path}`);
  }
  if (segments.some(s => s === '.' || s === '')) {
    throw new RepairChangeError('unsafe-path', index, `path is not canonical: ${path}`);
  }
}

/** Validate a stored change set before reading or writing repository files. */
export function validateRepairChanges(changes: RepairChange[]): void {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new RepairChangeError('invalid-change', -1, 'at least one change is required');
  }
  const seen = new Set<string>();
  changes.forEach((change, index) => {
    if (!change || (change.kind !== 'replace' && change.kind !== 'create')) {
      throw new RepairChangeError('invalid-change', index, 'change must have kind "replace" or "create"');
    }
    assertSafePath(change.path, index);
    if (seen.has(change.path)) {
      throw new RepairChangeError('duplicate-path', index, `conflicting duplicate change for: ${change.path}`);
    }
    seen.add(change.path);
    if (change.kind === 'replace' && (typeof change.before !== 'string' || change.before === '' || typeof change.after !== 'string')) {
      throw new RepairChangeError('invalid-change', index, 'replace requires non-empty before text and after text');
    }
    if (change.kind === 'create' && typeof change.content !== 'string') {
      throw new RepairChangeError('invalid-change', index, 'create requires file content');
    }
  });
}

/**
 * Apply structured changes to an in-memory file map.
 * Pure and all-or-nothing: every change is validated first; if any change
 * fails, nothing is applied and the input map is never mutated.
 */
export function applyRepairChanges(
  files: Record<string, string>,
  changes: RepairChange[],
): Record<string, string> {
  validateRepairChanges(changes);
  // Pass 1 — validate file preconditions.
  changes.forEach((change, index) => {
    if (change.kind === 'replace') {
      const current = files[change.path];
      if (current === undefined) {
        throw new RepairChangeError('missing-file', index, `replace target does not exist: ${change.path}`);
      }
      const occurrences = current.split(change.before).length - 1;
      if (occurrences === 0) {
        throw new RepairChangeError('missing-before', index, `"before" text not found in: ${change.path}`);
      }
      if (occurrences > 1) {
        throw new RepairChangeError(
          'ambiguous-before',
          index,
          `"before" text appears ${occurrences} times in: ${change.path}`,
        );
      }
    } else {
      if (files[change.path] !== undefined) {
        throw new RepairChangeError('file-exists', index, `create target already exists: ${change.path}`);
      }
    }
  });

  // Pass 2 — apply onto a copy; validation above guarantees no partial state.
  const next: Record<string, string> = { ...files };
  for (const change of changes) {
    if (change.kind === 'replace') {
      next[change.path] = next[change.path].replace(change.before, change.after);
    } else {
      next[change.path] = change.content;
    }
  }
  return next;
}
