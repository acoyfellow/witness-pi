import { describe, expect, test } from 'bun:test';
import { DEFAULT_RULES, registerBuiltins } from '../src/extension.ts';
import { evaluate } from '../src/gate.ts';
import * as registry from '../src/registry.ts';

function opts() {
  registry._reset();
  registerBuiltins();
  return { rules: DEFAULT_RULES };
}

describe('command-safety on everyday tools', () => {
  test('ALLOWS a normal ls', async () => {
    const r = await evaluate({ toolName: 'bash', input: { command: 'ls -la' } }, opts());
    expect(r).toBeUndefined();
  });

  test('BLOCKS git commit with verify disabled', async () => {
    const cmd = 'git commit --' + 'no-verify' + ' -m x';
    const r = await evaluate({ toolName: 'bash', input: { command: cmd } }, opts());
    expect(r?.block).toBe(true);
    expect(r?.reason).toContain('verify');
  });

  test('BLOCKS write to dotenv', async () => {
    const r = await evaluate(
      { toolName: 'write', input: { path: '/tmp/.env', content: 'FOO=1' } },
      opts(),
    );
    expect(r?.block).toBe(true);
    expect(r?.reason).toContain('secret-shaped path');
  });

  test('BLOCKS secret-shaped token in a write', async () => {
    const token = `sk-${'x'.repeat(28)}`;
    const r = await evaluate(
      { toolName: 'write', input: { path: 'src/a.ts', content: `const k="${token}"` } },
      opts(),
    );
    expect(r?.block).toBe(true);
    expect(r?.reason).toContain('secret-shaped');
  });

  test('ALLOWS a normal edit payload', async () => {
    const r = await evaluate(
      { toolName: 'edit', input: { path: 'src/a.ts', oldText: 'a', newText: 'b' } },
      opts(),
    );
    expect(r).toBeUndefined();
  });
});
