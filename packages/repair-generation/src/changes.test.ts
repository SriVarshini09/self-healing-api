import { describe, it, expect } from 'vitest';
import { applyRepairChanges, RepairChangeError } from './changes.js';

const BASE = {
  'src/a.ts': 'const x = 1;\nconst y = 2;\n',
  'src/b.ts': 'export const ok = true;\n',
};

describe('applyRepairChanges', () => {
  it('applies a successful replace', () => {
    const next = applyRepairChanges(BASE, [
      { kind: 'replace', path: 'src/a.ts', before: 'const x = 1;', after: 'const x = 42;' },
    ]);
    expect(next['src/a.ts']).toBe('const x = 42;\nconst y = 2;\n');
    // input map is never mutated
    expect(BASE['src/a.ts']).toBe('const x = 1;\nconst y = 2;\n');
  });

  it('applies a successful create', () => {
    const next = applyRepairChanges(BASE, [
      { kind: 'create', path: 'src/new.ts', content: 'export const n = 1;\n' },
    ]);
    expect(next['src/new.ts']).toBe('export const n = 1;\n');
    expect(next['src/a.ts']).toBe(BASE['src/a.ts']);
  });

  it('applies multiple file changes at once', () => {
    const next = applyRepairChanges(BASE, [
      { kind: 'replace', path: 'src/a.ts', before: 'const y = 2;', after: 'const y = 3;' },
      { kind: 'create', path: 'src/c.ts', content: 'export const c = 0;\n' },
    ]);
    expect(next['src/a.ts']).toContain('const y = 3;');
    expect(next['src/c.ts']).toBe('export const c = 0;\n');
    expect(next['src/b.ts']).toBe(BASE['src/b.ts']);
  });

  it('rejects a replace whose before text is missing', () => {
    expect(() =>
      applyRepairChanges(BASE, [
        { kind: 'replace', path: 'src/a.ts', before: 'const nope = 0;', after: 'x' },
      ]),
    ).toThrowError(RepairChangeError);
    expect(() =>
      applyRepairChanges(BASE, [
        { kind: 'replace', path: 'src/a.ts', before: 'const nope = 0;', after: 'x' },
      ]),
    ).toThrowError(/missing-before/);
  });

  it('rejects a replace whose before text is ambiguous', () => {
    const files = { 'src/dup.ts': 'x = 1;\nx = 1;\n' };
    expect(() =>
      applyRepairChanges(files, [{ kind: 'replace', path: 'src/dup.ts', before: 'x = 1;', after: 'x = 2;' }]),
    ).toThrowError(/ambiguous-before/);
  });

  it('rejects path traversal', () => {
    for (const path of ['../evil.ts', 'src/../../evil.ts', 'a/../..']) {
      expect(() =>
        applyRepairChanges(BASE, [{ kind: 'create', path, content: 'x' }]),
      ).toThrowError(/unsafe-path/);
    }
  });

  it('rejects absolute paths', () => {
    for (const path of ['/etc/passwd', 'C:/win.ini', 'C:\\win.ini', '\\server\\x']) {
      expect(() =>
        applyRepairChanges(BASE, [{ kind: 'create', path, content: 'x' }]),
      ).toThrowError(/unsafe-path/);
    }
  });

  it('rejects conflicting duplicate changes for one path', () => {
    expect(() =>
      applyRepairChanges(BASE, [
        { kind: 'replace', path: 'src/a.ts', before: 'const x = 1;', after: 'const x = 2;' },
        { kind: 'replace', path: 'src/a.ts', before: 'const y = 2;', after: 'const y = 3;' },
      ]),
    ).toThrowError(/duplicate-path/);
    expect(() =>
      applyRepairChanges(BASE, [
        { kind: 'create', path: 'src/n.ts', content: 'a' },
        { kind: 'create', path: 'src/n.ts', content: 'b' },
      ]),
    ).toThrowError(/duplicate-path/);
  });

  it('rejects creating a file that already exists', () => {
    expect(() =>
      applyRepairChanges(BASE, [{ kind: 'create', path: 'src/a.ts', content: 'overwrite' }]),
    ).toThrowError(/file-exists/);
    expect(BASE['src/a.ts']).toBe('const x = 1;\nconst y = 2;\n');
  });

  it('applies nothing when any change fails', () => {
    const snapshot = { ...BASE };
    expect(() =>
      applyRepairChanges(BASE, [
        { kind: 'replace', path: 'src/a.ts', before: 'const x = 1;', after: 'const x = 9;' },
        { kind: 'replace', path: 'src/b.ts', before: 'missing text', after: 'x' },
      ]),
    ).toThrowError(RepairChangeError);
    // earlier change was valid but must not leak through; input untouched.
    expect(BASE).toEqual(snapshot);
  });
});
