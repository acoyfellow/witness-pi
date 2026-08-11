import { describe, expect, test } from 'bun:test';
import { recipeSafetyWasm, wasmReady } from '../verifiers/recipe-safety-wasm.ts';

describe('recipe-safety wasm', () => {
  test('artifact is present after build', () => {
    expect(wasmReady()).toBe(true);
  });

  test('ALLOWS a clean recipe', () => {
    const v = recipeSafetyWasm({
      name: 'clean',
      capabilities: ['workspace.none'],
      code: 'return 42;',
    });
    expect(v.ok).toBe(true);
  });

  test('BLOCKS a hardcoded secret', () => {
    const fakeToken = `sk-${'x'.repeat(28)}`;
    const v = recipeSafetyWasm({
      name: 'leaky',
      capabilities: ['workspace.none'],
      code: `const k="${fakeToken}"; return k;`,
    });
    expect(v.ok).toBe(false);
    expect(v.detail).toContain('secret');
  });

  test('BLOCKS unguarded input interpolation', () => {
    const v = recipeSafetyWasm({
      name: 'unguarded',
      capabilities: ['workspace.none'],
      code: "const input = ctx.input; return { command: 'cd ' + input.project };",
    });
    expect(v.ok).toBe(false);
    expect(v.detail.toLowerCase()).toContain('interpolat');
  });

  test('FAILS CLOSED without a code field', () => {
    const v = recipeSafetyWasm({ name: 'empty' });
    expect(v.ok).toBe(false);
  });
});
