// Regression tests from the 2026-07-12 dogfood pass (docs/ROUGH-EDGES.md).
// Each pins a rough edge so a future edit can't silently regress it.
import { beforeEach, describe, expect, test } from 'bun:test';
import { DEFAULT_RULES, registerBuiltins } from '../src/extension.ts';
import { evaluate } from '../src/gate.ts';
import { signVerdict, verifyReceipt } from '../src/ref-receipt.ts';
import * as registry from '../src/registry.ts';

beforeEach(() => {
  registry._reset();
  registerBuiltins();
});

const push = (recipe: unknown) => ({ action: 'push', recipe });
const strRecipe = (o: unknown) => JSON.stringify(o);

describe('RE-2: artifactOf precedence + shapes', () => {
  test('string recipe (the MCP transport reality) is parsed and gated', async () => {
    const r = await evaluate(
      {
        toolName: 'pantry',
        input: push(strRecipe({ name: 's', code: 'return 1;', capabilities: ['workspace.none'] })),
      },
      { rules: DEFAULT_RULES },
    );
    expect(r).toBeUndefined(); // clean -> allowed
  });

  test('string recipe with a secret is BLOCKED', async () => {
    const r = await evaluate(
      {
        toolName: 'pantry',
        input: push(
          strRecipe({
            name: 's',
            code: `const k="sk-${'A'.repeat(24)}";`,
            capabilities: ['workspace.none'],
          }),
        ),
      },
      { rules: DEFAULT_RULES },
    );
    expect(r?.block).toBe(true);
  });

  test('object recipe still works', async () => {
    const r = await evaluate(
      {
        toolName: 'pantry',
        input: push({ name: 'o', code: 'return 1;', capabilities: ['workspace.none'] }),
      },
      { rules: DEFAULT_RULES },
    );
    expect(r).toBeUndefined();
  });

  test('fail-closed: null / missing / malformed / array recipe all block', async () => {
    for (const input of [push(null), { action: 'push' }, push('{not json'), push('[1,2,3]')]) {
      const r = await evaluate({ toolName: 'pantry', input }, { rules: DEFAULT_RULES });
      expect(r?.block).toBe(true);
    }
  });

  test('non-push actions pass through untouched', async () => {
    for (const action of ['get', 'list', 'run']) {
      const r = await evaluate(
        { toolName: 'pantry', input: { action, name: 'x' } },
        { rules: DEFAULT_RULES },
      );
      expect(r).toBeUndefined();
    }
  });
});

describe('RE-1: secret screen scope', () => {
  test('contiguous secret is caught', async () => {
    const r = await evaluate(
      {
        toolName: 'pantry',
        input: push(
          strRecipe({
            name: 'c',
            code: `const k="sk-${'A'.repeat(24)}";`,
            capabilities: ['workspace.none'],
          }),
        ),
      },
      { rules: DEFAULT_RULES },
    );
    expect(r?.block).toBe(true);
  });

  test('split-prefix evasion ("sk-" + ...) is now caught by the adjacency heuristic', async () => {
    const r = await evaluate(
      {
        toolName: 'pantry',
        input: push(
          strRecipe({
            name: 'e',
            code: `const k="sk-"+"${'A'.repeat(24)}";`,
            capabilities: ['workspace.none'],
          }),
        ),
      },
      { rules: DEFAULT_RULES },
    );
    expect(r?.block).toBe(true);
  });
});

describe('RB-1: no fail-open (round-2 terrarium findings)', () => {
  const secret = `const k="sk-${'A'.repeat(24)}";`;
  const bad = (o: unknown) => ({ action: 'push', recipe: strRecipe(o) });
  const ev = (input: unknown, tool = 'pantry') =>
    evaluate({ toolName: tool, input } as never, { rules: DEFAULT_RULES });

  test('capitalized action PUSH still gates', async () => {
    const r = await ev({
      action: 'PUSH',
      recipe: strRecipe({ name: 'x', code: secret, capabilities: ['workspace.none'] }),
    });
    expect(r?.block).toBe(true);
  });
  test('wrong-case toolName Pantry still gates', async () => {
    const r = await ev(
      bad({ name: 'x', code: secret, capabilities: ['workspace.none'] }),
      'Pantry',
    );
    expect(r?.block).toBe(true);
  });
  test('array of recipes fails closed', async () => {
    const r = await ev(
      bad([
        { name: 'a', code: 'return 1;' },
        { name: 'b', code: secret },
      ]),
    );
    expect(r?.block).toBe(true);
  });
  test('double-nested recipe fails closed', async () => {
    const r = await ev(bad({ recipe: { name: 'x', code: secret } }));
    expect(r?.block).toBe(true);
  });
  test('code-less object fails closed (not allowed)', async () => {
    const r = await ev(bad({ name: 'x', capabilities: ['workspace.none'] }));
    expect(r?.block).toBe(true);
  });
});

describe('RB-1b: round-2 evasions (secret in any field, whitespace, namespaced tool)', () => {
  const secret = `sk-${'A'.repeat(24)}`;
  const ev = (input: unknown, tool = 'pantry') =>
    evaluate({ toolName: tool, input } as never, { rules: DEFAULT_RULES });
  const clean = { name: 'x', code: 'return 1;', capabilities: ['workspace.none'] };

  test('secret in description (not code) is blocked', async () => {
    expect(
      (await ev({ action: 'push', recipe: strRecipe({ ...clean, description: secret }) }))?.block,
    ).toBe(true);
  });
  test('secret in inputSchema default is blocked', async () => {
    expect(
      (
        await ev({
          action: 'push',
          recipe: strRecipe({ ...clean, inputSchema: { default: secret } }),
        })
      )?.block,
    ).toBe(true);
  });
  test('action with surrounding whitespace still gates', async () => {
    expect(
      (
        await ev({
          action: ' push ',
          recipe: strRecipe({ ...clean, code: `const k="${secret}";` }),
        })
      )?.block,
    ).toBe(true);
  });
  test('namespaced tool names still gate', async () => {
    for (const tool of ['functions.pantry', 'mcp__pantry', 'pantry.push', ' pantry ']) {
      expect(
        (
          await ev(
            { action: 'push', recipe: strRecipe({ ...clean, code: `const k="${secret}";` }) },
            tool,
          )
        )?.block,
      ).toBe(true);
    }
  });
  test('clean recipe still allowed after all the tightening', async () => {
    expect(await ev({ action: 'push', recipe: strRecipe(clean) })).toBeUndefined();
  });
});

describe('RB-2: schema is signed', () => {
  test('changing the envelope/receipt schema after signing is rejected', () => {
    const r = signVerdict(
      { tool: 't', verifier: 'v', actionId: 'a', observation: 'o' },
      { ok: false, detail: 'x' },
    );
    expect(verifyReceipt(r)).toBe(true);
    const tampered = { ...r, schema: 'evil/schema@9' as never };
    expect(verifyReceipt(tampered)).toBe(false);
    const tampered2 = { ...r, receipt: { ...r.receipt, schema: 'evil/schema@9' as never } };
    expect(verifyReceipt(tampered2)).toBe(false);
  });
});

describe('RE-3: integrity vs authorship', () => {
  const sign = (ok: boolean) =>
    signVerdict(
      { tool: 't', verifier: 'v', actionId: 'a', observation: 'o' },
      { ok, detail: ok ? 'good' : 'bad' },
    );

  test('unpinned verify proves integrity only (any self-consistent key verifies)', () => {
    const forged = sign(true); // a "forger" signs a pass with its own fresh key
    expect(verifyReceipt(forged)).toBe(true); // integrity holds...
  });

  test('pinning trustedKeys rejects a receipt from an untrusted key', () => {
    const real = sign(false);
    const trusted = [real.publicKey];
    expect(verifyReceipt(real, trusted)).toBe(true); // trusted signer

    const forged = sign(true);
    // forged.publicKey is a different (fresh) key -> not in trusted set
    if (forged.publicKey !== real.publicKey) {
      expect(verifyReceipt(forged, trusted)).toBe(false);
    }
  });

  test('tampering still fails even with the right trusted key', () => {
    const real = sign(false);
    const tampered = { ...real, receipt: { ...real.receipt, result: 'pass' as const } };
    expect(verifyReceipt(tampered, [real.publicKey])).toBe(false);
  });
});
