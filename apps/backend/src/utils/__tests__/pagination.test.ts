import { describe, expect, it } from 'vitest';
import { clampInt, pageParams } from '../pagination.js';

describe('pageParams', () => {
  it('uses defaults when missing', () => {
    expect(pageParams({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('clamps negative, zero, huge and fractional values', () => {
    expect(pageParams({ page: '-1', pageSize: '99999' })).toEqual({ page: 1, pageSize: 100 });
    expect(pageParams({ page: '0', pageSize: '0' })).toEqual({ page: 1, pageSize: 1 });
    expect(pageParams({ page: '2.9', pageSize: '10.5' })).toEqual({ page: 2, pageSize: 10 });
  });

  it('ignores non-numbers', () => {
    expect(pageParams({ page: 'abc', pageSize: ['5'] })).toEqual({ page: 1, pageSize: 5 });
    expect(pageParams({ page: 'NaN', pageSize: 'Infinity' })).toEqual({ page: 1, pageSize: 20 });
  });
});

describe('clampInt', () => {
  it('keeps values inside the range', () => {
    expect(clampInt('50', 10, 1, 200)).toBe(50);
    expect(clampInt('-5', 10, 1, 200)).toBe(1);
    expect(clampInt('', 10, 1, 200)).toBe(10);
  });
});
