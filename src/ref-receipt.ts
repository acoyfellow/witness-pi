// ref engine, folded into witness (consolidation decided 2026-07-12).
//
// Turns a witness Verdict into a ref-signed PORTABLE RECEIPT
// (`ref/e23-portable-receipt@1`): Ed25519-signed, third-party-verifiable with
// only {receipt, signature, publicKey} — no witness code, no ref code.
//
// This is the upgrade over the old unsigned receipts.jsonl line: every
// block/allow now leaves a receipt a stranger can re-verify. The gate keeps
// blocking on `ok:false`; this only changes what the receipt IS.
import {
  type KeyObject,
  createHash,
  createPrivateKey,
  createPublicKey,
  verify as edVerify,
  generateKeyPairSync,
  sign,
} from 'node:crypto';
import type { Verdict } from './types.ts';

const SCHEMA = 'ref/e23-portable-receipt@1';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// canonical (sorted-key) serialization — the exact algorithm ref uses, so a
// receipt signed here verifies with ref's / any independent verifier.
export function canonical(v: unknown): string {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new TypeError('no non-finite numbers');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  throw new TypeError(`cannot serialize ${typeof v}`);
}

export type WitnessReceiptVerdict = {
  version: '1';
  tool: string;
  verifier: string;
  actionId: string;
  observationSha256: string; // hash of the evidence the verifier saw
  result: 'pass' | 'fail';
  detail: string;
  issuedAt: string;
  keyId: string;
};

export type PortableReceipt = {
  schema: typeof SCHEMA;
  receipt: WitnessReceiptVerdict;
  signature: string;
  publicKey: string; // raw Ed25519 public key, base64
};

function loadSigner(): { key: KeyObject; keyId: string } {
  // Private key from env (WITNESS_SIGNING_PEM) or ephemeral for a session.
  // In production this is a Worker secret / KMS handle the actor cannot read.
  const pem = process.env.WITNESS_SIGNING_PEM;
  const key = pem ? createPrivateKey(pem) : generateKeyPairSync('ed25519').privateKey;
  const pub = rawPub(key);
  return { key, keyId: `witness-${sha256(pub).slice(0, 8)}` };
}
function rawPub(priv: KeyObject): string {
  const jwk = createPublicKey(priv).export({ format: 'jwk' }) as { x: string };
  return Buffer.from(jwk.x, 'base64url').toString('base64');
}

let cached: { key: KeyObject; keyId: string } | null = null;
function signer() {
  if (!cached) cached = loadSigner();
  return cached;
}

// Sign a witness verdict into a portable receipt.
export function signVerdict(
  ctx: { tool: string; verifier: string; actionId: string; observation: string },
  verdict: Verdict,
): PortableReceipt {
  const { key, keyId } = signer();
  const receipt: WitnessReceiptVerdict = {
    version: '1',
    tool: ctx.tool,
    verifier: ctx.verifier,
    actionId: ctx.actionId,
    observationSha256: sha256(ctx.observation),
    result: verdict.ok ? 'pass' : 'fail',
    detail: verdict.detail,
    issuedAt: new Date().toISOString(),
    keyId,
  };
  const signature = sign(null, Buffer.from(canonical(receipt)), key).toString('base64');
  return { schema: SCHEMA, receipt, signature, publicKey: rawPub(key) };
}

// Independent verify — the same check a third party runs with only the envelope.
export function verifyReceipt(pr: PortableReceipt): boolean {
  try {
    const der = Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      Buffer.from(pr.publicKey, 'base64'),
    ]);
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    return edVerify(
      null,
      Buffer.from(canonical(pr.receipt)),
      key,
      Buffer.from(pr.signature, 'base64'),
    );
  } catch {
    return false;
  }
}

export function publicKey(): string {
  return rawPub(signer().key);
}
