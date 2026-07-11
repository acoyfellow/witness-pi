# witness self-audit — is the gate theater?

A witness that always passes is worse than none: it manufactures false
confidence. witness must be able to prove it earns its cost, or be deleted —
the same rule this project applied to every other tool.

## The signal

`installWitness({ onVerdict })` receives every verdict, pass or fail. Wire it
to a receipts sink and track, per verifier:

- **block-rate** — fraction of watched calls it blocked. Zero over a long
  window on real (non-test) artifacts = the verifier never catches anything =
  candidate for removal.
- **false-block-rate** — blocks later overridden by a human as wrong. High =
  the verifier is too strict and creates friction.
- **catch provenance** — did a block correspond to a real bug (good) or a
  false positive (bad)?

## Decision rule (mirrors the tooling audit)

- KEEP: blocks real faults at a non-trivial rate with low false-blocks.
- TUNE: high false-block-rate → loosen the verifier.
- REMOVE: zero real catches over ~30d of genuine use → it is ceremony.

## Adversarial obligation

Before trusting a verifier, try to fool it: an artifact that passes but is
subtly wrong. Every gap found is documented here. A verifier's value is
bounded by the faults it can *miss*, not the ones it catches in tests.

### Known gaps (recipe-safety v0)

- Static analysis of recipe `code` only. A recipe that builds a command via
  runtime string construction the regexes don't model could slip a missing
  guard past it. Backtest-style behavioral verification (replay real inputs,
  compare output) is the stronger complement and is the next verifier to wire.
- Secret patterns are a denylist; a novel token format is not caught. Pairs
  with the mine-time redaction (defense in depth), not a substitute.
