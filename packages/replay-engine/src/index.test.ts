import { describe, it, expect } from 'vitest';
import { replay } from './index.js';

describe('replay-engine', () => {
  it('verifies a fix that adds missing field', () => {
    const expr = 'event.payload.plan !== undefined';
    const events = [
      { type: 'provisioning.completed', payload: {}, headers: {} },
      { type: 'provisioning.completed', payload: {}, headers: {} },
    ];
    const before = replay(expr, events, 'noop');
    expect(before.passed).toBe(false);
    const after = replay(expr, events, 'add_field:plan:"pro"');
    expect(after.passed).toBe(true);
    expect(after.passRate).toBe(1);
  });
});
