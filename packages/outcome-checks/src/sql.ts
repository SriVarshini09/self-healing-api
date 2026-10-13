// SQL guard for customer-supplied outcome queries.
//
// The query runs against the customer's own database, so the real safety
// boundary is the runner: a READ ONLY transaction with a statement timeout,
// ideally on a read-only database role. This validator is defense in depth and
// keeps queries to a single SELECT (or WITH ... SELECT) statement.

export class OutcomeSqlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutcomeSqlError';
  }
}

const MAX_SQL_LENGTH = 4000;

// Statements and functions a pure existence check never needs.
const FORBIDDEN = [
  'insert', 'update', 'delete', 'merge', 'upsert', 'drop', 'alter', 'create', 'truncate',
  'grant', 'revoke', 'copy', 'call', 'do', 'execute', 'prepare', 'deallocate', 'lock',
  'vacuum', 'analyze', 'cluster', 'reindex', 'refresh', 'comment', 'security', 'listen',
  'notify', 'unlisten', 'set', 'reset', 'begin', 'commit', 'rollback', 'savepoint',
  'into', 'pg_sleep', 'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'lo_import',
  'lo_export', 'dblink', 'pg_terminate_backend', 'pg_cancel_backend', 'set_config',
];

const PARAM_PATTERN = /(?<![:\w]):([A-Za-z_][A-Za-z0-9_]*)/g;

/** Remove quoted string literals and quoted identifiers so keyword checks ignore their contents. */
function stripQuoted(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
}

/**
 * Validate an outcome query and return it normalized (trimmed, one optional
 * trailing semicolon removed). Throws OutcomeSqlError when it is not a single
 * read-only SELECT.
 */
export function validateOutcomeSql(sql: string): string {
  if (typeof sql !== 'string') throw new OutcomeSqlError('SQL must be a string');
  let normalized = sql.trim();
  if (!normalized) throw new OutcomeSqlError('SQL is empty');
  if (normalized.length > MAX_SQL_LENGTH) throw new OutcomeSqlError(`SQL is longer than ${MAX_SQL_LENGTH} characters`);
  if (normalized.endsWith(';')) normalized = normalized.slice(0, -1).trimEnd();

  const unquoted = stripQuoted(normalized);
  if (/--|\/\*|\*\//.test(unquoted)) throw new OutcomeSqlError('SQL comments are not allowed');
  if (unquoted.includes(';')) throw new OutcomeSqlError('Only one statement is allowed');
  if (/\$\d/.test(unquoted)) throw new OutcomeSqlError('Use :named parameters, not $1 placeholders');

  const lower = unquoted.toLowerCase();
  if (!/^(select|with)\b/.test(lower)) throw new OutcomeSqlError('Query must start with SELECT or WITH');
  for (const word of FORBIDDEN) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) {
      throw new OutcomeSqlError(`"${word.toUpperCase()}" is not allowed in an outcome query`);
    }
  }
  return normalized;
}

/** Names of the :params used by a query, in first-use order. */
export function sqlParamNames(sql: string): string[] {
  const names: string[] = [];
  for (const match of stripQuoted(sql).matchAll(PARAM_PATTERN)) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

/**
 * Turn `:name` parameters into Postgres `$n` placeholders. `::casts` and text
 * inside quotes are left alone. Returns the compiled text and the parameter
 * names in placeholder order.
 */
export function compileNamedParams(sql: string): { text: string; names: string[] } {
  const names = sqlParamNames(sql);
  // Rebuild segment by segment so quoted literals are never rewritten.
  const parts = sql.split(/('(?:[^']|'')*'|"(?:[^"]|"")*")/);
  const text = parts
    .map((part, index) => (index % 2 === 1
      ? part
      : part.replace(PARAM_PATTERN, (_whole, name: string) => `$${names.indexOf(name) + 1}`)))
    .join('');
  return { text, names };
}
