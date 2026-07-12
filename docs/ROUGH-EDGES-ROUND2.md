# Dogfood round 2 — parallel via terrarium (2026-07-12)

3 adversarial children (secrets / gate / crypto) fanned out through terrarium
(spawn works again; spawn_batch still hangs the MCP call, ran individual spawns).
Findings classified honestly: real bug vs. correct-behavior vs. known-limit.

## REAL BUGS to fix

### RB-1 (serious, gate): fail-OPEN on recipe shapes that dodge artifactOf
The gate child found secret-bearing recipes slip to ALLOW when:
- nested `{recipe:{recipe:{...secret...}}}` (double-nested)
- an ARRAY of recipes `[clean, secret]`
- `action` absent (rule `when` requires action==='push')
- `action:'PUSH'` capitalized
- `toolName:'Pantry'` wrong case
- JSON with `__proto__`/`constructor` keys + nested secret

Root cause: `artifactOf` + the rule matcher only handle the exact shape
`{action:'push', recipe:<string|object>}`. Anything else → artifact is not the
recipe → passes through (fail-OPEN). Some of these are arguably out of scope
(the real pantry tool only emits `action:'push'` lowercase), BUT:
- **case-insensitive `action` and `toolName`** should match (cheap, real).
- **array-of-recipes** and **double-nested** should at least fail-CLOSED (block)
  rather than silently allow, OR be explicitly documented as unhandled.
- The `__proto__` case is really "secret nested somewhere artifactOf doesn't
  look" — same class.
Fix: normalize action/tool case; if `action==='push'` (any case) but the recipe
can't be extracted to a checkable object, **fail closed** (block), never allow.

### RB-2 (minor, crypto): schema / envelope fields are unsigned
`schema` discriminator and unknown top-level envelope fields are neither signed
nor checked — an attacker can change `schema` or add envelope fields and it
still verifies. Fix: fold `schema` into the signed payload (or verify it), and
optionally reject unknown top-level keys.

## KNOWN LIMIT — now confirmed with data (document, don't "fix" naively)

### KL-1 (secrets): the syntactic screen misses real evasions
6 of 7 evasions slipped: base64, String.fromCharCode, hex escapes,
comment-obfuscation, runtime-fetch, unicode-homoglyph. Only the split-prefix
`"sk-"+"..."` (which we just added) was caught. This CONFIRMS RE-1: recipe-safety
is an honest-mistake screen, not a secret scanner. The SCOPE note is now
evidence-backed. Do NOT chase every evasion (endless); the honest move is the
scope disclaimer + not overclaiming. (A real secret scanner is a different tool.)

## CORRECT BEHAVIOR (child's expectation was wrong) — not bugs

- number/boolean recipe, 1MB non-JSON string → BLOCK (fail-closed). Correct.
- integrity-only accepts self-signed forged receipt → correct + documented;
  pinned trustedKeys rejects it → correct. (RE-3 fix working.)
- unicode NFC/NFD, confusable key, unexpected receipt field, tampered field →
  all rejected. Canonical signing is sound.
- number 1 vs 1.0, JSON -0 → 0 → accepted; correct (JSON collapses them).
  The `-0` vs `+0` note only affects direct JS callers, not JSON receipts — edge
  of an edge; note it, don't gold-plate.
- 100k-nested receipt → rejected via catch. Fine.

## CROSS-CUTTING observation

- **RB-3 (evidence integrity): deep/ची unstringifiable artifacts** collapse to
  `"[object Object]"` via `safeStringify` swallowing `JSON.stringify` failure, so
  `observationSha256` becomes non-unique. Low severity (verdict still correct)
  but the receipt's observation binding is weakened for pathological inputs.
  Fix: on stringify failure, bind a distinguishing fallback (e.g. a structural
  hash or an explicit "unstringifiable" marker), not a constant.

## Round-2 re-dogfood (after fixes) — 47 cases, classified

A second terrarium child hammered the fixed gate. 19 "fail-open" reported;
classified honestly:

**FIXED (were real):**
- secret in `description` / `inputSchema` / any field (not just `code`) — now
  the whole recipe is scanned (snapshotted once, TOCTOU-safe).
- action `" push "` / `"push\0"` whitespace/NUL — normalized.
- toolName `functions.pantry` / `mcp__pantry` / `pantry.push` / trimmed —
  namespace-tolerant match.
- getter/Proxy that shows clean bytes then dirty — closed by the single
  `JSON.stringify` snapshot the scan and the verifier both read.

**OUT OF SCOPE (not a real Pi tool_call shape) — documented, not "fixed":**
- "Map used as entire tool input", "input wrapped in a one-element array",
  "entire input as a JSON string", "input under an `input` key", "action moved
  to an `operation` key". Pi delivers a `tool_call` as the tool's argument
  OBJECT; these are not shapes the runtime produces. witness gates the real
  contract, not arbitrary hostile re-wrappings of the event envelope. If the
  host framework ever changes the envelope, that's a host-level concern.

## Round-3 re-dogfood (attack the fixes) — 33 cases, 5 holes

**FIXED (real):**
- regex false-positive: `my-pantry-tool` wrongly matched the `pantry` rule
  (treated `-` as a namespace separator). Tightened: only `.`/`:`/`/`/`__` are
  namespace separators, not `-`. Verified: `functions.pantry`/`mcp__pantry`/
  `ns:pantry` gate; `my-pantry-tool`/`pantryhelper`/`xpantry` do not.

**OUT OF SCOPE (documented, not fixed) — KL-1 boundary, again:**
- 4 secret-scan evasions all require an in-memory hostile OBJECT: a root
  `toJSON()` returning clean bytes, a non-enumerable property, a Symbol-keyed
  field, or a stateful getter. witness gates a `tool_call` whose recipe arrives
  as a **JSON string over the MCP wire** — by the time it reaches the gate it has
  already been JSON-serialized, so `toJSON`/non-enumerable/Symbol/getter tricks
  cannot survive transport. These are reachable only by a DIRECT JS caller
  handing `evaluate()`/`recipeSafety()` a live hostile object, not by the real
  Pi path. Same class as KL-1: recipe-safety is a syntactic screen on the
  serialized recipe, not a runtime taint tracker. Documented; not chased.

## Priority
1. RB-1 fail-open normalization (the one that matters — a gate that fails OPEN is
   the worst failure mode for this tool).
2. RB-2 sign the schema.
3. KL-1 scope disclaimer (evidence-backed now).
4. RB-3 observation fallback.
