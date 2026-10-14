import { describe, expect, it, vi } from 'vitest';
import { evaluatePredicate, isRelevantEvent, validatePredicate } from '@shapi/invariant-engine';

vi.mock('../../config.js', () => ({ config: { JWT_SECRET: 'x'.repeat(32), SHAPI_ENCRYPTION_KEY: undefined }, blockPrivateDatabaseHosts: () => false }));
vi.mock('../../utils/prisma.js', () => ({ prisma: {} }));

const { outcomeEventTypes, outcomeInvariantPredicate } = await import('../outcome-checks.js');
const { decryptSecret, describeDatabaseUrl, encryptSecret } = await import('../../utils/secrets.js');

const CHECK_ID = '0b6f2f53-8a52-4c3e-9f6d-2a1f5f2d9c11';

describe('outcome invariant predicate', () => {
  const predicate = outcomeInvariantPredicate(CHECK_ID);
  const types = outcomeEventTypes(CHECK_ID);

  it('is a valid sandboxed predicate', () => {
    expect(() => validatePredicate(predicate)).not.toThrow();
  });

  it('only counts this check\'s outcome events as samples', () => {
    expect(isRelevantEvent(predicate, types.passed)).toBe(true);
    expect(isRelevantEvent(predicate, types.failed)).toBe(true);
    expect(isRelevantEvent(predicate, 'invoice.payment_succeeded')).toBe(false);
    expect(isRelevantEvent(predicate, outcomeEventTypes('another-check').failed)).toBe(false);
  });

  it('passes on a passed outcome and fails on a failed one', () => {
    expect(evaluatePredicate(predicate, { type: types.passed, payload: {}, headers: {} }).passed).toBe(true);
    expect(evaluatePredicate(predicate, { type: types.failed, payload: {}, headers: {} }).passed).toBe(false);
  });
});

describe('secrets at rest', () => {
  it('round-trips and never stores plaintext', () => {
    const url = 'postgresql://readonly:hunter2@db.example.com:5432/app';
    const token = encryptSecret(url);
    expect(token).not.toContain('hunter2');
    expect(token).not.toBe(encryptSecret(url)); // random IV per encryption
    expect(decryptSecret(token)).toBe(url);
  });

  it('rejects tampered ciphertext', () => {
    const [version, iv, tag, ciphertext] = encryptSecret('rk_test_abc').split(':');
    const flipped = Buffer.from(ciphertext, 'base64');
    flipped[0] ^= 0xff;
    expect(() => decryptSecret([version, iv, tag, flipped.toString('base64')].join(':'))).toThrow();
  });

  it('describes a database without credentials', () => {
    expect(describeDatabaseUrl('postgresql://readonly:hunter2@db.example.com:5432/app')).toBe('db.example.com:5432/app');
  });
});
