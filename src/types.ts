// The witness contract. A verifier is deterministic code that takes an
// artifact and returns a verdict. It NEVER decides its own "ok" from the
// agent's say-so — it runs a real check and reports evidence.

export type Verdict = {
  ok: boolean;
  /** Human-readable one-line reason, surfaced to the agent when blocked. */
  detail: string;
  /** Optional structured evidence (counts, samples) for receipts. */
  evidence?: Record<string, unknown>;
};

// A verifier receives the artifact under test and returns a Verdict.
// `artifact` shape is verifier-specific (a recipe object, a diff, a path).
export type Verifier = (artifact: unknown) => Promise<Verdict> | Verdict;

// A gate rule: when a watched tool call matches, run these verifiers.
export type GateRule = {
  /** Tool name to watch, e.g. "pantry". */
  tool: string;
  /**
   * Optional predicate over the tool-call input. If present and false, the
   * rule does not apply (e.g. only gate pantry calls whose action is "push").
   */
  when?: (input: Record<string, unknown>) => boolean;
  /**
   * Extract the artifact to verify from the tool-call input.
   * e.g. for pantry push: (input) => input.recipe
   */
  artifactOf: (input: Record<string, unknown>) => unknown;
  /** Verifier names to run (resolved against the registry). ALL must pass. */
  verifiers: string[];
};
