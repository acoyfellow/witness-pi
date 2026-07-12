# Contributing

Small, focused, honest. This is a `0.0.1` experiment; the bar is that every
claim is backed by a runnable check.

## Setup

```sh
bun install
bun run check   # biome + tsc + tests, all must pass
bun run prove   # the one-command proof
```

## The rules

1. **A checker must be able to say no.** A verifier that can't fail is theater.
   If you add one, add a test that proves it blocks a real bad input AND allows
   a real good one.
2. **No mocks in the proof path.** Tests run the real gate, real crypto, real
   verifiers. `bun run prove` must stay honest.
3. **`bun run check` is the gate.** Biome (format + lint), `tsc --noEmit`, and
   the test suite must all pass before a PR merges. CI runs the same thing.
4. **Never commit a secret or a `workers_dev: true` config with real bindings.**
   The examples default to `workers_dev: false`.
5. **Keep it minimal.** Version stays `0.0.1`. If it needs a dependency, justify
   it in the PR.

## Adding a checker

A checker is a `Verifier`: `(artifact) => Verdict` (`{ ok, detail, evidence? }`).
Register it (`src/registry.ts`), wire a `GateRule` to a watched tool
(`src/extension.ts`), and add a test in `tests/`. See `verifiers/` for examples.

## Reporting bugs

Open an issue with a minimal reproduction. If it's a security issue, see
[SECURITY.md](SECURITY.md).
