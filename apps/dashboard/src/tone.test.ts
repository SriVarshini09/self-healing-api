import { describe, expect, it } from 'vitest';
import { toneFor } from './App';

describe('toneFor', () => {
  it('maps healthy states to green', () => {
    expect(toneFor('HEALTHY')).toBe('green');
    expect(toneFor('resolved')).toBe('green');
  });

  it('maps in-progress states to amber', () => {
    expect(toneFor('TRIAGED')).toBe('amber');
    expect(toneFor('replaying')).toBe('amber');
  });

  it('maps failure states to red', () => {
    expect(toneFor('VIOLATED')).toBe('red');
    expect(toneFor('high')).toBe('red');
  });

  it('falls back to gray', () => {
    expect(toneFor('UNKNOWN_STATE')).toBe('gray');
  });
});
