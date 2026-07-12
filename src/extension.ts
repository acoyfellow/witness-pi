// witness extension entrypoint. Registers the built-in verifiers and installs
// the gate. Default policy: gate `pantry` calls with action "push", verifying
// the recipe with `recipe-safety` before it can reach the store.

import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { recipeBacktest } from '../verifiers/recipe-backtest.ts';
import { recipeSafety } from '../verifiers/recipe-safety.ts';
import { installWitness } from './gate.ts';
import * as registry from './registry.ts';
import type { GateRule } from './types.ts';

// Every verdict (pass or fail) is appended here so a live block leaves disk
// evidence and the self-audit can compute a real catch-rate. The path is read
// at write time (not import time) so WITNESS_RECEIPTS can be set per-run.
export function receiptsPath(): string {
  return process.env.WITNESS_RECEIPTS ?? join(homedir(), '.pi', 'witness', 'receipts.jsonl');
}

export function writeReceipt(record: unknown): void {
  try {
    const path = receiptsPath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(record)}\n`);
  } catch {
    // receipts are best-effort; never break a session over logging
  }
}

export const DEFAULT_RULES: GateRule[] = [
  {
    tool: 'pantry',
    when: (input) => input.action === 'push',
    artifactOf: (input) => input.recipe,
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
