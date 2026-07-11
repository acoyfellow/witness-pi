import { beforeEach, describe, expect, test } from 'bun:test';
import { DEFAULT_RULES } from '../src/extension.ts';
import { evaluate } from '../src/gate.ts';
import * as registry from '../src/registry.ts';
import { recipeSafety } from '../verifiers/recipe-safety.ts';

const opts = () => ({ rules: DEFAULT_RULES });

// A known-good recipe: the real project_check we shipped this session.
const goodRecipe = {
  name: 'project_check',
  capabilities: ['workspace.none'],
  code:
    'const input = (ctx && ctx.input) || {};\n' +
    "const project = String(input.project || '');\n" +
    "if (!/^[A-Za-z0-9._\\/-]+$/.test(project) || project.includes('..') || project.startsWith('/')) throw new Error('bad project: ' + project);\n" +
    "let command = 'cd ~/cloudflare/' + project + ' && npm run check';\n" +
    'return { command };',
};

beforeEach(() => {
  registry._reset();
  registry.register('recipe-safety', recipeSafety);
});

describe('witness gate over pantry push', () => {
  test('ALLOWS the known-good project_check recipe', async () => {
    const r = await evaluate(
      { toolName: 'pantry', input: { action: 'push', recipe: goodRecipe } },
      opts(),
    );
    expect(r).toBeUndefined(); // no block
  });

  test('BLOCKS a recipe with a hardcoded secret', async () => {
    // Build a fake token at runtime so no literal secret-shaped string exists
    // in this file (keeps secret scanners from flagging a test fixture).
    const fakeToken = `sk-${'x'.repeat(28)}`;
    const bad = {
      name: 'leaky',
      capabilities: ['workspace.none'],
      code: `return { command: 'curl -H "Authorization: Bearer ${fakeToken}"' };`,
    };
    const r = await evaluate(
      { toolName: 'pantry', input: { action: 'push', recipe: bad } },
      opts(),
    );
    expect(r?.block).toBe(true);
    expect(r?.reason).toContain('secret');
  });

  test('BLOCKS a recipe that interpolates input without a guard', async () => {
    const bad = {
      name: 'unguarded',
      capabilities: ['workspace.none'],
      code: "const input = ctx.input; return { command: 'cd ~/cloudflare/' + input.project + ' && npm run check' };",
    };
    const r = await evaluate(
      { toolName: 'pantry', input: { action: 'push', recipe: bad } },
      opts(),
    );
    expect(r?.block).toBe(true);
    expect(r?.reason).toContain('guard');
  });

  test('BLOCKS capability over-declaration (machine.shell but returns a string)', async () => {
    const bad = {
      name: 'overcap',
      capabilities: ['machine.shell'],
      code: "return { command: 'echo hello' };",
    };
    const r = await evaluate(
      { toolName: 'pantry', input: { action: 'push', recipe: bad } },
      opts(),
    );
    expect(r?.block).toBe(true);
    expect(r?.reason).toContain('machine.shell');
  });

  test('IGNORES non-push pantry calls (run/list/get pass through)', async () => {
    const r = await evaluate(
      { toolName: 'pantry', input: { action: 'run', name: 'project_check' } },
      opts(),
    );
    expect(r).toBeUndefined();
  });

  test('IGNORES unrelated tools', async () => {
    const r = await evaluate({ toolName: 'bash', input: { command: 'ls' } }, opts());
    expect(r).toBeUndefined();
  });
});
