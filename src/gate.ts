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

// A rule tool matches the event tool if, after trimming whitespace/NUL and
// lowercasing, the event tool equals the rule tool OR ends with a common
// namespace separator + the rule tool (functions./mcp__/pantry.push style).
function toolMatches(ruleTool: string, eventTool: string): boolean {
  const norm = (s: string) => s.replace(/[\s\0]+/g, '').toLowerCase();
  const rt = norm(ruleTool);
  const et = norm(eventTool);
  if (et === rt) return true;
  // namespaced: functions.pantry / mcp__pantry / pantry.push
  return new RegExp(`(^|[._:/-]|__)${rt}([._:/-]|__|$)`).test(et);
}

// Core decision, extracted for direct unit testing without a live Pi.
export async function evaluate(
  event: ToolCallEvent,
  options: WitnessOptions,
): Promise<ToolCallEventResult> {
  const now = () => new Date().toISOString();
  for (const rule of options.rules) {
    // case-insensitive + trimmed + prefix-tolerant tool match: `Pantry`,
    // ` pantry `, `functions.pantry`, `mcp__pantry`, `pantry.push` all match the
    // `pantry` rule (RB-1 / round-2). A host may namespace tool names.
    if (!toolMatches(rule.tool, event.toolName)) continue;
    if (rule.when && !rule.when(event.input)) continue;
    const artifact = rule.artifactOf(event.input);
    const observation = safeStringify(artifact);
    for (const name of rule.verifiers) {
      const verdict = await registry.get(name)(artifact);
      options.onVerdict?.({
        tool: event.toolName,
        verifier: name,
        verdict,
        observation,
        at: now(),
      });
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
  try {
    const s = JSON.stringify(v);
    if (typeof s === 'string') return s;
  } catch {
    // fall through to a DISTINGUISHING fallback (RB-3): never collapse every
    // unstringifiable artifact to the same constant, or observationSha256 stops
    // being unique. Walk the top-level keys + a bounded string coercion.
  }
  try {
    const keys =
      v && typeof v === 'object'
        ? Object.keys(v as object)
            .sort()
            .join(',')
        : typeof v;
    return `<unstringifiable:${keys}:${String(v).slice(0, 64)}>`;
  } catch {
    return `<unstringifiable:${typeof v}>`;
  }
}

// Install the gate on a Pi ExtensionAPI (loose type to avoid a hard dep here).
export function installWitness(
  pi: { on: (event: string, handler: (e: ToolCallEvent) => unknown) => void },
  options: WitnessOptions,
): void {
  pi.on('tool_call', (event) => evaluate(event, options));
}
