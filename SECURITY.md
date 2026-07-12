# Security

## The trust model, stated plainly

`witness` exists because an agent shouldn't decide its own work is done. Its
guarantees and its limits:

**What it guarantees**
- A verdict is produced by a checker, not by the agent's say-so.
- A watched action is **blocked** (cancelled before it runs) when its checker fails.
- Each verdict is an Ed25519-signed portable receipt (`ref/e23-portable-receipt@1`)
  the agent cannot forge and a third party can re-verify with only the public key.

**What it does NOT guarantee**
- **It only watches the actions you configure.** By default, one. The agent can
  still take actions `witness` never sees. This is a gate, not a sandbox.
- **Checkers are trusted code that runs on your machine.** Only wire in a checker
  you have read. A malicious checker is your own code running.
- **The signing key must live where the agent can't read it.** In the in-process
  extension, the key is generated per-session; for a real trust boundary, hold
  the key in a Worker secret / Durable Object the actor has no binding to (see
  `examples/fresh-account-e2e`). A key the actor can read is a key the actor can
  forge with.
- **A checker that never blocks is dead weight**, not safety. `witness` records
  its catch-rate so you can delete a theater checker (see `docs/self-audit.md`).

## Reporting a vulnerability

Open a private security advisory on the GitHub repository, or email the address
on the author's GitHub profile. Please do not open a public issue for a
vulnerability until it has been addressed.

## Scope

This is a `0.0.1` experiment, MIT-licensed, provided as-is. Read the code before
you run it.
