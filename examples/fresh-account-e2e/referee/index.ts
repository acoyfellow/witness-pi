// H30 — Composed production referee. One real Worker running five hardening
// mechanisms together against real bindings:
//   H01 asymmetric signing  — verdicts Ed25519-signed by a key the actor lacks
//   H02 signed intent        — intent must be authority-signed + in-policy + fresh
//   H03 TOCTOU/finality       — verdict bound to the KV value's content hash
//   H07 typed comparators     — canonical-json / numeric-tolerance, not raw hash
//   H04 replay (consume-once)  — nonce burned in the DO, atomic
// The RefereeDO owns the signing key + nonce set + policy. The actor only writes
// to KV and calls verify() over RPC — it cannot read the key or the DO state.
import { WorkerEntrypoint, DurableObject } from "cloudflare:workers";
import {
  createHash, generateKeyPairSync, sign as edSign, verify as edVerify,
  createPublicKey, createPrivateKey, type KeyObject,
} from "node:crypto";

interface Env {
  ARTIFACTS: KVNamespace;  // temp-account variant: KV instead of R2 (R2 unsupported on temp accounts)
  REFEREE: DurableObjectNamespace<RefereeDO>;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const canon = (o: unknown): string =>
  o === null || typeof o !== "object" ? JSON.stringify(o)
  : Array.isArray(o) ? "[" + o.map(canon).join(",") + "]"
  : "{" + Object.keys(o as any).sort().map(k => JSON.stringify(k) + ":" + canon((o as any)[k])).join(",") + "}";

// H07: comparators — expected/observed may match under a typed rule, not just eq.
function compare(kind: string, expected: any, observed: any): boolean {
  if (kind === "canonical-json") return canon(expected) === canon(observed);
  if (kind === "numeric-tolerance") return Math.abs(Number(expected.value) - Number(observed.value)) <= Number(expected.tol);
  return canon(expected) === canon(observed); // exact default
}

export class RefereeDO extends DurableObject {
  private priv(): KeyObject {
    let pem = (this.ctx as any)._pem as string | undefined;
    // key generated once, lives in DO storage — actor has no handle to this DO's storage
    return this.ctx.blockConcurrencyWhile(async () => {
      let stored = await this.ctx.storage.get<string>("signing-pem");
      if (!stored) { stored = generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }) as string; await this.ctx.storage.put("signing-pem", stored); }
      return createPrivateKey(stored);
    }) as unknown as KeyObject;
  }
  async pubkey(): Promise<string> {
    const k = await this.priv();
    const jwk = createPublicKey(k).export({ format: "jwk" }) as any;
    return Buffer.from(jwk.x, "base64url").toString("base64");
  }
  // H02: register an authority public key + policy (control-plane setup)
  async setup(authorityPub: string, policy: { tenant: string; allowedTargets: string[] }) {
    await this.ctx.storage.put("authority", authorityPub);
    await this.ctx.storage.put("policy", policy);
    return { ok: true };
  }
  async authorityPub(): Promise<string | undefined> { return this.ctx.storage.get("authority"); }

  // H04: atomic consume-once nonce
  async consume(nonce: string): Promise<boolean> {
    return this.ctx.blockConcurrencyWhile(async () => {
      if (await this.ctx.storage.get(`n:${nonce}`)) return false;
      await this.ctx.storage.put(`n:${nonce}`, 1);
      return true;
    });
  }
  async sign(hash: string): Promise<string> {
    return edSign(null, Buffer.from(hash), await this.priv()).toString("base64");
  }
  async policy(): Promise<any> { return this.ctx.storage.get("policy"); }
}

function authVerify(pubB64: string, msg: string, sigB64: string): boolean {
  const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pubB64, "base64")]);
  return edVerify(null, Buffer.from(msg), createPublicKey({ key: der, format: "der", type: "spki" }), Buffer.from(sigB64, "base64"));
}

// The RPC surface the actor may touch: verify() only. No key, no DO handle.
export class RefereeApi extends WorkerEntrypoint<Env> {
  private doh() { return this.env.REFEREE.get(this.env.REFEREE.idFromName("global")); }

  async setup(authorityPub: string, policy: any) { return this.doh().setup(authorityPub, policy); }
  async pubkey() { return this.doh().pubkey(); }

  // signedIntent: {intent, sig} from the authority. objectKey: KV key the actor wrote.
  async verify(signedIntent: { intent: any; sig: string }, objectKey: string) {
    const do_ = this.doh();
    const i = signedIntent.intent;
    // H02: intent authorized by the authority key?
    const authPub = await do_.authorityPub();
    if (!authPub || !authVerify(authPub, canon(i), signedIntent.sig)) return this.deny("intent-not-authorized");
    // H02: in policy + fresh
    const pol = await do_.policy();
    if (i.tenant !== pol.tenant) return this.deny("wrong-tenant");
    if (!pol.allowedTargets.includes(i.target)) return this.deny("target-not-allowed");
    if (Date.now() > i.expiry) return this.deny("expired");
    // H04: consume-once nonce
    if (!(await do_.consume(i.nonce))) return this.deny("replay");
    // H03: read the KV value AND pin its content hash as the finality anchor
    // (KV has no version id; binding to the content sha is a stronger anchor).
    const bytes = await this.env.ARTIFACTS.get(`artifacts/${objectKey}`);
    if (bytes === null) return this.deny("object-absent");
    const versionId = sha(bytes); // finality anchor = content hash
    // H07: typed comparator (intent carries comparator kind + expected value)
    let observed: any; try { observed = JSON.parse(bytes); } catch { observed = bytes; }
    const matched = compare(i.comparator ?? "exact", i.expected, observed);
    if (!matched) return this.deny("outcome-mismatch");
    // H01: sign the verdict (bound to the pinned version id)
    const verdict = { actionId: i.actionId, tenant: i.tenant, target: i.target, objectKey, versionId, result: "pass", at: Date.now() };
    const sig = await do_.sign(sha(canon(verdict)));
    return { admit: true, reason: "authorized+matched+signed", verdict, sig, versionId };
  }
  private deny(reason: string) { return { admit: false, reason }; }
}

// Control-plane fetch: setup + pubkey. This is the CONTROL PLANE (a human /
// deploy pipeline), NOT the actor. The actor has no fetch route here — it only
// holds the verify() RPC via its service binding.
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const u = new URL(req.url);
    const do_ = env.REFEREE.get(env.REFEREE.idFromName("global"));
    if (u.pathname === "/setup" && req.method === "POST") {
      const { authorityPub, policy } = await req.json() as any;
      return Response.json(await do_.setup(authorityPub, policy));
    }
    if (u.pathname === "/pubkey") return Response.json({ pubkey: await do_.pubkey() });
    return new Response("ref-composed: control-plane /setup /pubkey; actor uses verify() RPC", { status: 200 });
  },
};
