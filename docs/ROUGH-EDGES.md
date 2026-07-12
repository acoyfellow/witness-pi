# Dogfood findings — rough edges (2026-07-12)

Drove the real gate with 15 adversarial/edge inputs. 6 "unexpected"; classified
honestly below — most are correct fail-closed behavior; two are real.

## Correct behavior (my test expectation was wrong) — NOT bugs

- **#4 recipe=null, #5 no recipe key, #7 malformed JSON, #8 JSON array** all
  BLOCK with `artifact is not a recipe object`. That is **fail-closed and
  correct** — an unparseable/absent recipe on a push should be blocked, not
  waved through. Keeping.
  - Nuance worth a doc line: a blocked push on a *malformed* recipe surfaces a
    slightly opaque reason ("not a recipe object"). Could be friendlier
    ("couldn't parse the recipe to check it") but the decision is right.

## Real rough edges — FIX

### RE-1 (serious): secret-via-concatenation evades recipe-safety
`code: 'const k="sk-"+"AAAA…";'` → **PASSES** (`ok:true`), while the same secret
as one literal is caught. The regex `/sk-[A-Za-z0-9]{20,}/` only matches a
contiguous secret. A trivially split string slips through.
- Honest framing: recipe-safety is a **cheap syntactic screen, not a secret
  scanner**. It catches the honest mistake (paste a key), not a motivated
  evader. That limit must be STATED (README/SECURITY), or the checker
  overclaims. Options: (a) document it as best-effort + name the evasion; (b)
  add a light heuristic (flag `"sk-" +` adjacency); (c) both. Do NOT claim it
  stops exfiltration — it doesn't.

### RE-2 (minor): #15 input+recipe both present → ALLOWED unexpectedly
Not actually a bug — my test malformed the recipe extraction; the gate allowed
because the extracted value wasn't a bad recipe. But it exposes that
`artifactOf` has several branches (string / object / flattened) and the
precedence isn't documented or unit-tested for the "both keys present" case.
- Fix: add explicit unit tests pinning `artifactOf` precedence
  (recipe-string > recipe-object > flattened > undefined), so a future edit
  can't silently change which wins.

## RE-3 (design gap to DOCUMENT): the receipt carries its own public key

A receipt is self-contained `{receipt, signature, publicKey}`, so it verifies in
any process — including cross-process (dogfooded: works). But that means
**"verifies" only proves the receipt wasn't tampered after signing — NOT that a
trusted witness signed it.** A forger can mint their own keypair, sign a
`result:pass` receipt, and it "verifies" against its own embedded key.
- The real trust anchor is **which public key you accept.** Verification must be
  "verifies AND publicKey ∈ trusted set," not "verifies." Today nothing pins the
  trusted key. `verifyReceipt` should take an optional `trustedKeys` and the
  docs must say: an unpinned receipt proves integrity, not authorship.
- Ephemeral key (no `WITNESS_SIGNING_PEM`) = a fresh identity per process; fine
  for a demo, useless as an identity. Persistent key via `WITNESS_SIGNING_PEM`
  gives a stable pubkey across processes (dogfooded: stable). Prod must set it,
  hold it where the actor can't read it (Worker secret / DO), and publish the
  pubkey out-of-band so verifiers can pin it.

## Signing engine: SOLID

15/15 adversarial receipt tests pass — every single-field tamper rejected,
cross-signature rejected, garbage/ wrong key rejected, weird unicode+newline
details round-trip, empty detail ok, canonical serialization order-independent.
The crypto layer is not a rough edge.

## Other observations

- **Opaque block reason** on unparseable input (see #4/5/7/8): consider a
  distinct reason string `recipe-unreadable` vs `not a recipe object` so a
  blocked agent knows to fix the SHAPE, not the content.
- **No test covers the string-recipe path** (the MCP reality that caused the
  original live bug). The battery proves it works now; it should be a committed
  regression test, not just a manual finding.
