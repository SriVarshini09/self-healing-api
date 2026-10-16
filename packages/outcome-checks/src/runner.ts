// Execute an outcome query against the customer's Postgres database.
//
// Safety boundary: every query runs inside a READ ONLY transaction with a
// statement timeout and is always rolled back. Customers should still connect
// SHAPI with a read-only role; this is the second line of defense.
import pg from 'pg';
import { compileNamedParams, validateOutcomeSql } from './sql.js';
import type { ParamValue } from './bind.js';
import { assertPublicDatabaseHost } from './network.js';

export interface OutcomeQueryResult {
  /** true when the query returned at least one row, i.e. the outcome exists */
  matched: boolean;
  rowCount: number;
  durationMs: number;
}

export interface RunOutcomeQueryOptions {
  connectionString: string;
  sql: string;
  params: ParamValue[];
  statementTimeoutMs?: number;
  connectTimeoutMs?: number;
  /** Hosted mode: refuse hosts that resolve to private or internal addresses. */
  blockPrivateHosts?: boolean;
}

const DEFAULT_STATEMENT_TIMEOUT_MS = 5_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

export function assertPostgresUrl(connectionString: string): void {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('Database URL is not a valid URL');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('Only postgres:// and postgresql:// database URLs are supported');
  }
}

export async function runOutcomeQuery(options: RunOutcomeQueryOptions): Promise<OutcomeQueryResult> {
  assertPostgresUrl(options.connectionString);
  // Checked on every run, not only when the check is saved, so a hostname later
  // re-pointed at an internal address is refused too.
  if (options.blockPrivateHosts) await assertPublicDatabaseHost(options.connectionString);
  const { text } = compileNamedParams(validateOutcomeSql(options.sql));
  const statementTimeout = Math.max(100, Math.min(options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS, 30_000));

  const client = new pg.Client({
    connectionString: options.connectionString,
    connectionTimeoutMillis: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    statement_timeout: statementTimeout,
    application_name: 'shapi-outcome-check',
  });
  // pg also emits 'error' on the client when the connection drops, in addition to rejecting the
  // running query. With no listener that is an uncaught exception, which takes down the whole API
  // (every tenant). The customer's database is outside our control: it can restart, or be a
  // server built to hang up mid-query. The failure already reaches the caller through the query.
  client.on('error', () => undefined);
  const started = Date.now();
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${statementTimeout}`);
    // Wrap so only existence is observed; customer row data never leaves their database.
    const result = await client.query(`SELECT 1 FROM (${text}) AS shapi_outcome LIMIT 1`, options.params);
    const rowCount = result.rowCount ?? 0;
    return { matched: rowCount > 0, rowCount, durationMs: Date.now() - started };
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}
