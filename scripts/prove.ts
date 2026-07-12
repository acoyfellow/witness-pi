#!/usr/bin/env bun
import { createPublicKey, verify as edVerify } from 'node:crypto';
import { DEFAULT_RULES, registerBuiltins } from '../src/extension.ts';
// `bun run prove` — the undeniable proof, in one command.
//
// Runs the real gate over a bad and a good action, shows it BLOCKS the bad one
// with a real reason, and proves the resulting receipt is Ed25519-signed and
// verifiable by a third party with ONLY {receipt, signature, publicKey} — then
// shows that tampering the verdict breaks verification. No network, no mocks.
import { evaluate } from '../src/gate.ts';
import { canonical, signVerdict, verifyReceipt } from '../src/ref-receipt.ts';
import { recipeSafety } from '../verifiers/recipe-safety.ts';

registerBuiltins();
const line = (s: string) => console.log(s);

// 1. the gate blocks a bad action with a real reason.
// Build the fake-secret string at runtime so no secret-shaped literal sits in
// this file (keeps real secret scanners quiet); recipe-safety still catches it.
const fakeSecret = `sk-${'A'.repeat(24)}`;
const bad = {
  action: 'push',
  recipe: JSON.stringify({
    name: 'leaky',
    inputSchema: {},
    code: `const k="${fakeSecret}"; return k;`,
    capabilities: ['workspace.none'],
  }),
};
const good = {
  action: 'push',
  recipe: JSON.stringify({
    name: 'clean',
    inputSchema: {},
    code: 'return 42;',
    capabilities: ['workspace.none'],
  }),
};
const badVerdict = await evaluate({ toolName: 'pantry', input: bad }, { rules: DEFAULT_RULES });
const goodVerdict = await evaluate({ toolName: 'pantry', input: good }, { rules: DEFAULT_RULES });

line('1. THE GATE DECIDES (not the agent)');
line(`   bad  push -> ${badVerdict?.block ? `BLOCKED: ${badVerdict.reason}` : 'allowed (WRONG)'}`);
line(`   good push -> ${goodVerdict ? 'blocked (WRONG)' : 'ALLOWED'}`);

// 2. the verdict becomes a signed, third-party-verifiable receipt
const recipe = JSON.parse(bad.recipe);
const receipt = signVerdict(
  {
    tool: 'pantry',
    verifier: 'recipe-safety',
    actionId: 'pantry:demo',
    observation: JSON.stringify(recipe),
  },
  recipeSafety(recipe),
);
line('\n2. THE VERDICT IS A SIGNED RECEIPT (ref/e23-portable-receipt@1)');
line(`   result=${receipt.receipt.result}  keyId=${receipt.receipt.keyId}`);
line(`   signature=${receipt.signature.slice(0, 24)}...`);

// 3. a STRANGER verifies it with only {receipt, signature, publicKey} + raw crypto
const der = Buffer.concat([
  Buffer.from('302a300506032b6570032100', 'hex'),
  Buffer.from(receipt.publicKey, 'base64'),
]);
const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
const strangerOk = edVerify(
  null,
  Buffer.from(canonical(receipt.receipt)),
  key,
  Buffer.from(receipt.signature, 'base64'),
);
line('\n3. A STRANGER RE-VERIFIES IT (no witness code, only node:crypto + public key)');
line(`   independent verify -> ${strangerOk ? 'VALID' : 'INVALID (WRONG)'}`);

// 4. tampering the verdict breaks the signature
const tampered = { ...receipt, receipt: { ...receipt.receipt, result: 'pass' as const } };
const tamperRejected = !verifyReceipt(tampered);
line('\n4. TAMPERING IS CAUGHT (flip result fail->pass)');
line(`   tampered verify -> ${tamperRejected ? 'INVALID (rejected)' : 'VALID (WRONG)'}`);

// 5. authorship: pinning the trusted key rejects a receipt from any other key.
const trusted = [receipt.publicKey];
const otherReceipt = signVerdict(
  { tool: 'pantry', verifier: 'recipe-safety', actionId: 'pantry:demo', observation: 'different' },
  { ok: true, detail: 'forged pass' },
);
// (same process reuses one signer key, so simulate a foreign key by pinning to it)
const foreignKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const authorshipEnforced = verifyReceipt(receipt, trusted) && !verifyReceipt(receipt, [foreignKey]);
line('\n5. AUTHORSHIP IS PINNED (trust a key, reject all others)');
line(`   trusted-key verify -> ${authorshipEnforced ? 'ENFORCED' : 'NOT ENFORCED (WRONG)'}`);
void otherReceipt;

const allOk =
  badVerdict?.block && !goodVerdict && strangerOk && tamperRejected && authorshipEnforced;
line(
  `\n${allOk ? 'PROVEN: the agent cannot decide, cannot forge, cannot tamper; and only a trusted key is accepted.' : 'FAILED'}`,
);
process.exit(allOk ? 0 : 1);
