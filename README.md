# witness

**A coding agent shouldn't get to decide its own work is done.**

`witness` is an extension for [Pi](https://github.com/earendil-works/pi-coding-agent),
a coding agent. It watches for a specific action the agent tries to take, runs
a real test against what the agent produced, and **blocks the action if the
test fails**. The agent can't wave its own work through. Something it doesn't
control has to pass it first.

## The problem

I had an agent generate a small script and tell me it was finished. I didn't
trust it, so I replayed 266 of my own past commands against it. It matched 36%
of them — it kept adding a line I never actually type. The agent had no idea it
was wrong, because nothing ever checked. It just said "done."

That's the gap `witness` closes. "Done" now has to be earned against a test the
agent can't edit or skip.

## How it works

Pi lets an extension see each action *before* it runs and cancel it. `witness`
uses that:

1. The agent tries to do a watched action.
2. `witness` grabs what the agent produced and runs a checker against it.
3. Pass -> the action goes through. Fail -> the action is blocked, and the
   agent is told exactly what failed.

A blocked action isn't the end. The failure comes back to the agent as the next
thing to fix. It tries again, and only gets through when it actually passes.

```
agent: "here's the finished thing, let me save it"
witness: runs the test
         PASS -> saved
         FAIL -> blocked, agent gets the reason, tries again
```

## What's in the box

- A **checker registry** — checkers are small functions that take the agent's
  work and return pass/fail with a reason.
- Two checkers to start:
  - one reads the code for obvious problems (a password typed straight into
    the code, unsafe handling of input);
  - one replays real past inputs and demands the output match exactly (this is
    the one that caught the 36% above).
- A **gate** that wires a checker to a watched action.

## Prove it yourself, in one command

```sh
bun install
bun run prove
```

It runs the real gate over a bad and a good action and prints:

```
1. THE GATE DECIDES (not the agent)
   bad  push -> BLOCKED: witness[recipe-safety] blocked pantry: recipe 'leaky' embeds a hardcoded secret
   good push -> ALLOWED
2. THE VERDICT IS A SIGNED RECEIPT (ref/e23-portable-receipt@1)
   result=fail  keyId=witness-...  signature=...
3. A STRANGER RE-VERIFIES IT (no witness code, only node:crypto + public key)
   independent verify -> VALID
4. TAMPERING IS CAUGHT (flip result fail->pass)
   tampered verify -> INVALID (rejected)
5. AUTHORSHIP IS PINNED (trust a key, reject all others)
   trusted-key verify -> ENFORCED

PROVEN: the agent cannot decide, cannot forge, cannot tamper;
        and only a trusted key is accepted.
```

That is the whole claim, executable: **the agent can't decide its own work is
done, can't forge a passing verdict, can't tamper one after the fact, and a
verdict only counts if it came from a key you trust.**

## Why the verdict is trustworthy

Every verdict is written to `~/.pi/witness/receipts.jsonl` as a **signed,
portable receipt** (`ref/e23-portable-receipt@1`): Ed25519-signed by a key the
agent never holds, and verifiable by anyone with only `{receipt, signature,
publicKey}` — no witness code, no shared secret.

```json
{"schema":"ref/e23-portable-receipt@1",
 "receipt":{"tool":"pantry","verifier":"recipe-safety","result":"fail",
            "detail":"recipe 'x' embeds a hardcoded secret","keyId":"witness-..."},
 "signature":"...","publicKey":"..."}
```

So a block isn't "trust me, it failed" — it's a receipt a third party (a
reviewer, a CI gate, an auditor) can re-check offline and cannot be forged.

## The other layers of proof

- **35 tests pass**, including regression tests for every hole found across three
  adversarial dogfood rounds (see `docs/ROUGH-EDGES*.md`). They block the real
  mistakes, allow known-good work, and — the one that matters — keep work
  *blocked* when it can't pass, and **fail closed** on any shape the gate can't
  read. A checker that always says "pass" is theater; these can say no.
- **A test loads the extension the way Pi does** — imports it, hands it the same
  object the runtime does, fires a real action through the registered handler.
  Proves the wiring, not just the checker.
- **A real agent session was blocked live**, leaving a signed receipt on disk
  (`witness[recipe-safety] blocked pantry: ... embeds a hardcoded secret`).
- **It runs capability-separated on a fresh Cloudflare account** — see
  [examples/fresh-account-e2e](examples/fresh-account-e2e/): the signing key
  lives where the agent can't reach it, proven end-to-end on a throwaway account.

## Install

Clone it into Pi's extensions folder (Pi loads anything there automatically):

```sh
git clone https://github.com/acoyfellow/witness-pi \
  ~/.pi/agent/extensions/witness
```

Run the tests with `bun install && bun test`, or the one-command proof with
`bun run prove`.

## What it does not do (read this)

- **It only watches the actions you point it at.** By default that's one. The
  agent can still run other commands `witness` never sees. This is a gate, not a
  sandbox.
- **The built-in `recipe-safety` checker is a cheap syntactic screen, not a
  secret scanner.** It catches the honest mistake (a key pasted into a recipe)
  and one split-prefix evasion. A motivated evader (base64, char codes, fetch a
  key at runtime) gets past it — we dogfooded this and confirmed it. Don't rely
  on it to stop exfiltration; use it to catch slips.
- **A checker is trusted code that runs on your machine.** Don't wire in a
  checker you didn't read. A malicious checker is your own code running.
- **A verdict "verifies" two different ways.** Without a trusted-key list, it
  proves only that the receipt wasn't *tampered*. To prove a *trusted* witness
  signed it, pass the public keys you accept (`verifyReceipt(r, trustedKeys)`);
  hold the signing key where the agent can't read it (see
  [examples/fresh-account-e2e](examples/fresh-account-e2e/)).
- **A checker that never catches anything is dead weight.** `witness` records
  how often it blocks so you can delete it if it earns nothing. See
  [docs/self-audit.md](docs/self-audit.md).

MIT.
