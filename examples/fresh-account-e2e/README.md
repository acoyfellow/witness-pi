# fresh-account e2e (h40)

Proof that witness's capability-separated verification runs end-to-end on a
**fresh Cloudflare account you don't have to own** — via `wrangler deploy
--temporary`. Composes the hardening mechanisms into two real Workers:

- **referee** — owns the Ed25519 signing key (in a Durable Object), the
  consume-once nonce set, and the policy. Exposes only `verify()` over RPC.
- **actor** — can write the artifact (KV) and call `verify()`. It has **no**
  binding to the signing key or the DO.

`run.mjs` drives the harness: a genuine action admits with a signed verdict that
verifies with the public key alone; every attack (self-declared intent,
out-of-policy, expired, replay, outcome mismatch) is denied.

`runs_h40_temp.json` is the recorded result (`H40-VERIFIED`, 7/7) from a live
temporary account. The account expired; the receipt is the durable proof.

## Reproduce (no Cloudflare account needed)

Wrangler >= 4.102, unauthenticated. See `DEPLOY-TEMP.md` for the isolation
incantation, then set the printed KV namespace id in both `wrangler.jsonc`
files (replacing `YOUR_TEMP_KV_NAMESPACE_ID`) and deploy referee then actor with
`--temporary`. R2 is unsupported on temp accounts, so the artifact store is KV.

## Note on `workers_dev`

The committed configs set `workers_dev: false` (safe default — no public URL with
bindings). The temporary-account e2e run flips it to `true` deliberately, because
a temp account is throwaway and the whole point is a hittable URL that expires.
Do **not** deploy these to a permanent account with `workers_dev: true`; put them
behind Access or keep it false.
