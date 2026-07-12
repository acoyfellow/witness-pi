// The witness gate. Hooks Pi's `tool_call` event; for each configured
// GateRule whose tool+predicate match, it extracts the artifact, runs the
// named verifiers in order, and BLOCKS the tool call (with the first failing
// verdict's detail as the reason) if any verdict is fail.
//
// A blocked call surfaces the failing case back to the agent — bounded heal,
// not silent acceptance. Passing verdicts are recorded to a receipts sink so
// witness can later audit its own catch-rate (theater detection).

import * as registry from './registry.ts';
import type { GateRule, Verdict } from './types.ts';

export type WitnessOptions = {
  rules: GateRule[];
  /**
   * Called with every verdict (pass or fail) for receipts/self-audit. The
   * `observation` is the canonical string the verifier judged, so the receipt
   * sink (ref-receipt) can bind + sign it into a portable receipt.
   */
  onVerdict?: (record: {
    tool: string;
    verifier: string;
    verdict: Verdict;
    observation: string;
    at: string;
  }) => void;
};

type ToolCallEvent = { toolName: string; input: Record<string, unknown> };
type ToolCallEventResult = { block?: boolean; reason?: string } | undefined;

// Core decision, extracted for direct unit testing without a live Pi.
export async function evaluate(
  event: ToolCallEvent,
  options: WitnessOptions,
): Promise<ToolCallEventResult> {
  const now = () => new Date().toISOString();
  for (const rule of options.rules) {
    if (rule.tool !== event.toolName) continue;
    if (rule.when && !rule.when(event.input)) continue;
    const artifact = rule.artifactOf(event.input);
    const observation = safeStringify(artifact);
    for (const name of rule.verifiers) {
      const verdict = await registry.get(name)(artifact);
      options.onVerdict?.({ tool: event.toolName, verifier: name, verdict, observation, at: now() });
      if (!verdict.ok) {
        return {
          block: true,
          reason: `witness[${name}] blocked ${event.toolName}: ${verdict.detail}`,
        };
      }
    }
  }
  return undefined; // no rule blocked — allow
}

function safeStringify(v: unknown): string {
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
}

// Install the gate on a Pi ExtensionAPI (loose type to avoid a hard dep here).
export function installWitness(
  pi: { on: (event: string, handler: (e: ToolCallEvent) => unknown) => void },
  options: WitnessOptions,
): void {
  pi.on('tool_call', (event) => evaluate(event, options));
}
