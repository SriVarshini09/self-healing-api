import { describe, expect, it } from 'vitest';
import { serializeJson } from '../json.js';

describe('serializeJson', () => {
  it('serializes BigInt columns instead of throwing', () => {
    const payload = {
      id: 'abc',
      installation: { githubInstallationId: BigInt(1789000000000), accountLogin: 'octo' },
    };
    expect(() => JSON.stringify(payload)).toThrow();
    const parsed = JSON.parse(serializeJson(payload)) as {
      installation: { githubInstallationId: number };
    };
    expect(parsed.installation.githubInstallationId).toBe(1789000000000);
  });

  it('passes strings through untouched', () => {
    expect(serializeJson('already-a-string')).toBe('already-a-string');
  });

  it('serializes normal payloads identically to JSON.stringify', () => {
    const payload = { a: 1, b: [true, null, 'x'], c: { d: 2.5 } };
    expect(serializeJson(payload)).toBe(JSON.stringify(payload));
  });
});
