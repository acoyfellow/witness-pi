import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// This test does NOT call evaluate() directly. It loads the extension exactly
// the way Pi does — imports the default export, hands it a `pi` object, and
// then fires the `tool_call` event through the handler the extension
// registered. That proves the whole wiring (default export -> installWitness
// -> pi.on('tool_call') -> verifier -> block), not just the decision function.

const receiptsDir = mkdtempSync(join(tmpdir(), 'witness-receipts-'));
const receiptsPath = join(receiptsDir, 'receipts.jsonl');
process.env.WITNESS_RECEIPTS = receiptsPath;

// Import AFTER setting the env var so RECEIPTS_PATH picks it up.
const extension = (await import('../src/extension.ts')).default;

// A stand-in for Pi's ExtensionAPI: records whatever handler the extension
// registers for 'tool_call', so we can invoke it like Pi would.
function makeFakePi() {
  const handlers: Record<string, (e: unknown) => unknown> = {};
  return {
    on: (event: string, handler: (e: unknown) => unknown) => {
      handlers[event] = handler;
    },
    fire: (event: string, payload: unknown) => handlers[event]?.(payload),
    registered: () => Object.keys(handlers),
  };
}

afterAll(() => rmSync(receiptsDir, { recursive: true, force: true }));

describe('live wiring: extension loaded the way Pi loads it', () => {
  const pi = makeFakePi();
  extension(pi as never); // this is what Pi calls on load

  test('the extension registered a tool_call handler', () => {
    expect(pi.registered()).toContain('tool_call');
  });

  test('firing a bad pantry push through the handler BLOCKS it', async () => {
    // Build a fake secret-shaped string at runtime so no literal credential
    // exists in this file. recipe-safety flags the sk- pattern in recipe code.
    const secret = `sk-${'a'.repeat(28)}`;
    const result = await pi.fire('tool_call', {
      toolName: 'pantry',
      input: {
        action: 'push',
        recipe: {
          name: 'leaky',
          capabilities: ['workspace.none'],
          code: `const key = '${secret}'; return { command: 'echo ' + key };`,
        },
      },
    });
    expect((result as { block?: boolean })?.block).toBe(true);
    expect((result as { reason?: string })?.reason).toContain('secret');
  });

  test('firing a clean pantry push through the handler ALLOWS it', async () => {
    const result = await pi.fire('tool_call', {
      toolName: 'pantry',
      input: {
        action: 'push',
        recipe: {
          name: 'project_check',
          capabilities: ['workspace.none'],
          code: "const p=String((ctx.input||{}).project||'');if(!/^[A-Za-z0-9._\\/-]+$/.test(p)||p.includes('..')||p.startsWith('/'))throw new Error('bad');return{command:'cd ~/cloudflare/'+p+' && npm run check'};",
        },
      },
    });
    expect(result).toBeUndefined(); // not blocked
  });

  test('the block left a real SIGNED receipt on disk that verifies independently', async () => {
    const { verifyReceipt } = await import('../src/ref-receipt.ts');
    expect(existsSync(receiptsPath)).toBe(true);
    const lines = readFileSync(receiptsPath, 'utf8').trim().split('\n').filter(Boolean);
    const records = lines.map((l) => JSON.parse(l));
    // receipts are now ref-signed portable receipts (ref/e23-portable-receipt@1)
    const fail = records.find((r) => r.receipt?.result === 'fail');
    expect(fail).toBeTruthy();
    expect(fail.schema).toBe('ref/e23-portable-receipt@1');
    expect(fail.receipt.tool).toBe('pantry');
    expect(fail.receipt.verifier).toBe('recipe-safety');
    // the signature verifies with only {receipt, signature, publicKey}
    expect(verifyReceipt(fail)).toBe(true);
    // tampering the verdict breaks verification
    const tampered = { ...fail, receipt: { ...fail.receipt, result: 'pass' } };
    expect(verifyReceipt(tampered)).toBe(false);
    // and at least one passing verdict for the clean recipe, also signed+valid
    const pass = records.find((r) => r.receipt?.result === 'pass');
    expect(pass).toBeTruthy();
    expect(verifyReceipt(pass)).toBe(true);
  });
});
