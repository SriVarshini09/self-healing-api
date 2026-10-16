// Integration test against a real Postgres. Runs only when
// OUTCOME_TEST_DATABASE_URL is set (a throwaway database it may create tables in).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { assertPostgresUrl, runOutcomeQuery } from './runner.js';

const url = process.env.OUTCOME_TEST_DATABASE_URL;
const SQL = "SELECT 1 FROM shapi_test_users WHERE stripe_customer_id = :customer AND plan_status = 'active'";

describe('assertPostgresUrl', () => {
  it('accepts postgres URLs only', () => {
    expect(() => assertPostgresUrl('postgresql://u:p@db:5432/app')).not.toThrow();
    expect(() => assertPostgresUrl('mysql://u:p@db/app')).toThrow(/postgres/);
    expect(() => assertPostgresUrl('not a url')).toThrow();
  });
});

describe.skipIf(!url)('runOutcomeQuery (real Postgres)', () => {
  const admin = new pg.Client({ connectionString: url });

  beforeAll(async () => {
    await admin.connect();
    await admin.query('DROP TABLE IF EXISTS shapi_test_users');
    await admin.query('CREATE TABLE shapi_test_users (stripe_customer_id text, plan_status text)');
    await admin.query("INSERT INTO shapi_test_users VALUES ('cus_ok', 'active'), ('cus_stuck', 'pending')");
  });

  afterAll(async () => {
    await admin.query('DROP TABLE IF EXISTS shapi_test_users');
    await admin.end();
  });

  it('matches when the outcome row exists', async () => {
    const result = await runOutcomeQuery({ connectionString: url!, sql: SQL, params: ['cus_ok'] });
    expect(result.matched).toBe(true);
  });

  it('does not match a paid-but-not-provisioned customer', async () => {
    expect((await runOutcomeQuery({ connectionString: url!, sql: SQL, params: ['cus_stuck'] })).matched).toBe(false);
    expect((await runOutcomeQuery({ connectionString: url!, sql: SQL, params: ['cus_unknown'] })).matched).toBe(false);
  });

  it('cannot write even through a writable function', async () => {
    await admin.query(`CREATE OR REPLACE FUNCTION shapi_test_write() RETURNS int AS $$
      BEGIN INSERT INTO shapi_test_users VALUES ('cus_injected', 'active'); RETURN 1; END $$ LANGUAGE plpgsql`);
    await expect(runOutcomeQuery({ connectionString: url!, sql: 'SELECT shapi_test_write()', params: [] }))
      .rejects.toThrow(/read-only/i);
    const { rowCount } = await admin.query("SELECT 1 FROM shapi_test_users WHERE stripe_customer_id = 'cus_injected'");
    expect(rowCount).toBe(0);
    await admin.query('DROP FUNCTION shapi_test_write()');
  });

  it('survives the database dropping the connection mid-query instead of crashing the process', async () => {
    const crashes: Error[] = [];
    const onCrash = (error: Error) => crashes.push(error);
    process.on('uncaughtException', onCrash);
    try {
      const running = runOutcomeQuery({
        connectionString: url!,
        sql: 'SELECT 1 FROM generate_series(1, 400000000) AS g WHERE g = -1',
        params: [],
        statementTimeoutMs: 20_000,
      });
      // Hang up from the database side while the query is running.
      let killed = 0;
      for (let attempt = 0; attempt < 40 && killed === 0; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        killed = (await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'shapi-outcome-check'")).rowCount ?? 0;
      }
      expect(killed).toBeGreaterThan(0);
      await expect(running).rejects.toThrow();
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(crashes.map(error => error.message)).toEqual([]);
    } finally {
      process.off('uncaughtException', onCrash);
    }
  });

  it('enforces the statement timeout', async () => {
    await admin.query(`CREATE OR REPLACE FUNCTION shapi_test_slow() RETURNS int AS $$
      BEGIN PERFORM pg_catalog.pg_sleep(2); RETURN 1; END $$ LANGUAGE plpgsql`);
    await expect(runOutcomeQuery({ connectionString: url!, sql: 'SELECT shapi_test_slow()', params: [], statementTimeoutMs: 200 }))
      .rejects.toThrow(/timeout/i);
    await admin.query('DROP FUNCTION shapi_test_slow()');
  });
});
