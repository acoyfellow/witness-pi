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

## Does it actually work?

Three levels of proof, weakest to strongest:

1. **13 unit tests pass.** They block the three real mistakes I made while
   building it (a secret typed into code, unsafe input handling, a tool
   claiming more permission than it uses) and allow known-good work. One test
   matters most: when the work *can't* pass the bar, `witness` keeps it blocked
   instead of quietly letting it through. A checker that always says "pass" is
   theater. These can say no.

2. **A test loads the extension the way the agent does** — imports it, hands it
   the same object the agent runtime does, and fires a real action through the
   handler it registered. That proves the wiring, not just the checker.

3. **A real agent session was actually blocked.** I asked a live agent to save
   a recipe that over-declared its permissions. It got stopped with:

   ```
   witness[recipe-safety] blocked pantry: recipe 'witness_live_probe'
   declares machine.shell but only returns a string; use workspace.none
   ```

   Every verdict is written to `~/.pi/witness/receipts.jsonl`, so a block
   leaves a timestamped record on disk:

   ```json
   {"tool":"pantry","verifier":"recipe-safety",
    "verdict":{"ok":false,"detail":"...declares machine.shell but only returns a string..."},
    "at":"2026-07-12T10:41:14.814Z"}
   ```

## What it does not do

- **It only watches the actions you point it at.** By default that's one. The
  agent can still run other commands that `witness` never sees. This is a
  pattern shown on one gate, not a wall around everything.
- **A checker is trusted code that runs on your machine.** Don't wire in a
  checker you didn't read.
- **A checker that never catches anything is dead weight.** `witness` records
  how often it blocks so you can delete it if it earns nothing. See
  [docs/self-audit.md](docs/self-audit.md).

## Install

Clone it into Pi's extensions folder (Pi loads anything there automatically):

```sh
git clone https://github.com/acoyfellow/witness-pi \
  ~/.pi/agent/extensions/witness
```

## Run the tests

```sh
bun install
bun test
```

MIT.
