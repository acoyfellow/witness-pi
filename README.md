# witness

**A verdict the agent does not author.**

Most agent loops trust the agent's own "done." `witness` routes the verdict
through an independent checker the agent cannot control: before a designated
action executes (e.g. a `pantry push`), a *witness* runs a real verifier
against the artifact and returns pass/fail. The agent cannot mark its own work
done — it can only produce an artifact that a witness then attests to, or not.

This is the [molt](../molt) discipline installed as a Pi extension: molt proved
the pattern in a container (build → fault → heal → independent accept);
`witness` makes the *accept* phase a standing gate in a normal session.

## The three roles, kept clean

| Role | Who | Rule |
|---|---|---|
| **produce** | the agent | writes the artifact (recipe, patch, tool) |
| **store** | pantry | holds artifacts AND verifiers as versioned, named recipes |
| **witness** | this extension | fetches a verifier, runs it *itself*, renders the verdict |

**Pantry is the shelf, not the inspector.** `witness` may read verifier code
*from* pantry (versioned, shareable), but it executes that code in its own
harness — never via `pantry run`, whose own guardrail says it is not a
sandbox. If the artifact under test could influence its own verifier, the
"agent can't grade itself" premise collapses. So: pantry stores; witness
judges.

## What it hooks

Pi's `tool_call` event returns `{ block, reason }`. `witness` intercepts
designated tool calls (default: `pantry` with `action: "push"`), runs the
mapped verifier against the artifact, and **blocks the call with the failing
detail as the reason** when the verdict is fail. A blocked push means the
failing case comes back to the agent as the next thing it must address —
bounded heal, not silent acceptance.

## Non-guarantees (honest)

- Not a sandbox. A verifier is trusted code; witness runs it in-process.
  Untrusted verifiers need a real isolate.
- Only gates the tool calls it is configured to watch. `bash` and external
  paths bypass it, exactly like mutex-pi.
- A witness that always passes is theater. Verifiers must be able to FAIL on
  real artifacts, and witness records its own catch-rate so it can be deleted
  if it never catches anything (see `docs/self-audit.md`).

## Status

Step 1 skeleton: the gate + verifier registry, with the recipe backtest wired
as the first real verifier. Not yet installed globally.
