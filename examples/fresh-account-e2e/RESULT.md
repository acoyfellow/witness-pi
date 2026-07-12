# h40 — Fresh-account e2e: VERIFIED

The composed capability-separated referee ran end-to-end on a REAL fresh
temporary Cloudflare account (`wrangler deploy --temporary`, (URLs below EXPIRED with the account) account "Obsidian
Chartreuse", claimed=never, expires 60min). Closes status.json's last unproven
item.

## What ran (live temp-account URLs, not local)
- referee: https://h40-referee.obsidian-chartreuse.workers.dev
- actor:   https://h40-actor.obsidian-chartreuse.workers.dev

## Result (runs_h40_temp.json) — H40-VERIFIED, 7/7
- genuine (H01 sign + H02 signed-intent + H03 finality + H04 consume-once + H07 comparators) -> admit, signed verdict VERIFIES with public key only
- H07 reordered keys -> match
- H02 actor self-declares intent -> denied (intent-not-authorized)
- H02 out-of-policy target -> denied
- outcome mismatch -> denied
- H04 replay nonce -> denied
- H02 expired -> denied
- actor bindings = {ARTIFACTS, REFEREE} only; no signing key, no DO reach

## Constraint handled
Temp accounts don't support R2. Swapped the artifact store R2->KV (a supported
temp-account primitive); every mechanism unchanged. Actor and referee share one
KV namespace (prod: same ns, actor write-scoped / referee read-scoped token).

## Reproduce (any stranger, no account)
Wrangler >=4.102, unauthenticated:
  env -i HOME=/tmp/x PATH="$PATH" XDG_CONFIG_HOME=/tmp/xc bash -c '
    cd referee && echo y | bunx wrangler@latest kv namespace create ARTIFACTS --temporary
    # set the printed id in referee+actor wrangler.jsonc, then:
    echo y | bunx wrangler@latest deploy --temporary        # referee
    cd ../actor && echo y | bunx wrangler@latest deploy --temporary
    REF_URL=... ACT_URL=... node ../run.mjs'
See DEPLOY-TEMP.md for the isolation incantation.

## Honest notes
- Local `wrangler dev` cross-worker RPC service binding was flaky; the temp
  account (both Workers in one account) resolved it natively — which is the
  point of the loop.
- Ephemeral: the account expires in 60 min unclaimed; URLs die with it. The
  receipt (runs_h40_temp.json) is the durable proof.
