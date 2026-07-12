// witness extension entrypoint. Registers the built-in verifiers and installs
// the gate. Default policy: gate `pantry` calls with action "push", verifying
// the recipe with `recipe-safety` before it can reach the store.

import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { recipeBacktest } from '../verifiers/recipe-backtest.ts';
import { recipeSafety } from '../verifiers/recipe-safety.ts';
import { installWitness } from './gate.ts';
import { signVerdict } from './ref-receipt.ts';
import * as registry from './registry.ts';
import type { GateRule, Verdict } from './types.ts';

// Every verdict (pass or fail) is appended here so a live block leaves disk
// evidence and the self-audit can compute a real catch-rate. The path is read
// at write time (not import time) so WITNESS_RECEIPTS can be set per-run.
export function receiptsPath(): string {
  return process.env.WITNESS_RECEIPTS ?? join(homedir(), '.pi', 'witness', 'receipts.jsonl');
}

export function writeReceipt(record: {
  tool: string;
  verifier: string;
  verdict: Verdict;
  observation?: string;
  at: string;
}): void {
  try {
    const path = receiptsPath();
    mkdirSync(dirname(path), { recursive: true });
    // ref engine (folded in): sign the verdict into a portable, third-party-
    // verifiable receipt (ref/e23-portable-receipt@1). Falls back to the raw
    // record only if signing throws, so logging never breaks a session.
    let line: unknown = record;
    try {
      const portable = signVerdict(
        {
          tool: record.tool,
          verifier: record.verifier,
          actionId: `${record.tool}:${record.at}`,
          observation: record.observation ?? '',
        },
        record.verdict,
      );
      line = { ...portable, at: record.at };
    } catch {
      // keep the unsigned record as a fallback
    }
    appendFileSync(path, `${JSON.stringify(line)}\n`);
  } catch {
    // receipts are best-effort; never break a session over logging
  }
}

export const DEFAULT_RULES: GateRule[] = [
  {
    tool: 'pantry',
    // case-insensitive + whitespace/NUL-trimmed: don't let `PUSH`, ` push `, or
    // `push\0` dodge the gate (RB-1 / round-2).
    when: (input) =>
      String(input.action ?? '')
        .replace(/[\s\0]+/g, '')
        .toLowerCase() === 'push',
    // The MCP transport delivers `recipe` as a JSON STRING (pantry coerces it in
    // execute(), but the tool_call gate fires before that). So parse a string
    // recipe here; also accept an already-object recipe or flattened fields.
    artifactOf: (input) => {
      const r = input.recipe;
      if (typeof r === 'string') {
        const s = r.trim();
        if (s.startsWith('{')) {
          try {
            return JSON.parse(s);
          } catch {
            return r;
          }
        }
        return r;
      }
      if (Array.isArray(r)) return r; // array-of-recipes: recipe-safety fails closed
      if (r && typeof r === 'object') return r;
      if (typeof input.name === 'string' && typeof input.code === 'string') return input;
      return r; // undefined -> recipe-safety fails closed (unknown shape)
    },
    verifiers: ['recipe-safety'],
  },
];

export function registerBuiltins(): void {
  if (!registry.has('recipe-safety')) registry.register('recipe-safety', recipeSafety);
  if (!registry.has('recipe-backtest')) registry.register('recipe-backtest', recipeBacktest);
}

// Pi loads this via auto-discovery (index.ts re-exports it).
export default function extension(pi: {
  on: (event: string, handler: (e: unknown) => unknown) => void;
}): void {
  registerBuiltins();
  installWitness(pi as never, { rules: DEFAULT_RULES, onVerdict: writeReceipt });
}
