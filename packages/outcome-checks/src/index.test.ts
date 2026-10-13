import { describe, expect, it } from 'vitest';
import {
  bindParams,
  compileNamedParams,
  OutcomeBindingError,
  OutcomeSqlError,
  sqlParamNames,
  validateBindings,
  validateOutcomeSql,
} from './index.js';

const PROVISIONED = "SELECT 1 FROM users WHERE stripe_customer_id = :customer AND plan_status = 'active'";

describe('validateOutcomeSql', () => {
  it('accepts a single SELECT and strips one trailing semicolon', () => {
    expect(validateOutcomeSql(`  ${PROVISIONED};  `)).toBe(PROVISIONED);
  });

  it('accepts WITH ... SELECT', () => {
    expect(() => validateOutcomeSql('WITH u AS (SELECT id FROM users) SELECT 1 FROM u')).not.toThrow();
  });

  it('allows columns that merely contain a forbidden word', () => {
    expect(() => validateOutcomeSql('SELECT 1 FROM subs WHERE updated_at > created_at AND reset_at IS NULL')).not.toThrow();
  });

  it('ignores forbidden words inside string literals', () => {
    expect(() => validateOutcomeSql("SELECT 1 FROM audit WHERE action = 'delete'")).not.toThrow();
  });

  it.each([
    ['DELETE FROM users', 'SELECT'],
    ['SELECT 1; DROP TABLE users', 'one statement'],
    ['SELECT 1 FROM users -- sneaky', 'comments'],
    ['SELECT 1 /* x */ FROM users', 'comments'],
    ['SELECT pg_sleep(10)', 'PG_SLEEP'],
    ['SELECT * INTO copy_of_users FROM users', 'INTO'],
    ['WITH d AS (DELETE FROM users RETURNING *) SELECT 1 FROM d', 'DELETE'],
    ['SELECT set_config(\'role\', \'admin\', false)', 'SET_CONFIG'],
    ['SELECT 1 FROM users WHERE id = $1', ':named'],
    ['', 'empty'],
  ])('rejects %s', (sql, message) => {
    expect(() => validateOutcomeSql(sql)).toThrow(OutcomeSqlError);
    expect(() => validateOutcomeSql(sql)).toThrow(new RegExp(message, 'i'));
  });
});

describe('compileNamedParams', () => {
  it('maps :names to $n in first-use order and reuses numbers', () => {
    const { text, names } = compileNamedParams('SELECT 1 FROM t WHERE a = :customer AND b = :plan OR c = :customer');
    expect(text).toBe('SELECT 1 FROM t WHERE a = $1 AND b = $2 OR c = $1');
    expect(names).toEqual(['customer', 'plan']);
  });

  it('leaves ::casts and quoted text alone', () => {
    const { text, names } = compileNamedParams("SELECT 1 FROM t WHERE a = :id::text AND note = 'at 10:30'");
    expect(text).toBe("SELECT 1 FROM t WHERE a = $1::text AND note = 'at 10:30'");
    expect(names).toEqual(['id']);
  });
});

describe('bindings', () => {
  const event = { type: 'invoice.payment_succeeded', data: { object: { customer: 'cus_123', amount_paid: 4900, lines: [] } } };

  it('resolves dot paths from the provider event', () => {
    expect(bindParams(['customer', 'amount'], { customer: 'data.object.customer', amount: 'data.object.amount_paid' }, event))
      .toEqual(['cus_123', 4900]);
  });

  it('refuses to run with a missing value instead of silently failing the outcome', () => {
    expect(() => bindParams(['customer'], { customer: 'data.object.missing' }, event)).toThrow(OutcomeBindingError);
  });

  it('refuses non-scalar values', () => {
    expect(() => bindParams(['lines'], { lines: 'data.object.lines' }, event)).toThrow(/not a scalar/);
  });

  it('requires bindings to match the query parameters exactly', () => {
    const names = sqlParamNames(PROVISIONED);
    expect(() => validateBindings(names, {})).toThrow(/customer/);
    expect(() => validateBindings(names, { customer: 'data.object.customer', extra: 'id' })).toThrow(/extra/);
    expect(() => validateBindings(names, { customer: 'data.object.customer; drop' })).toThrow(/invalid path/);
    expect(() => validateBindings(names, { customer: 'data.object.customer' })).not.toThrow();
  });
});
