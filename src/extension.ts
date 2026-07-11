// witness extension entrypoint. Registers the built-in verifiers and installs
// the gate. Default policy: gate `pantry` calls with action "push", verifying
// the recipe with `recipe-safety` before it can reach the store.

import { recipeBacktest } from '../verifiers/recipe-backtest.ts';
import { recipeSafety } from '../verifiers/recipe-safety.ts';
import { installWitness } from './gate.ts';
import * as registry from './registry.ts';
import type { GateRule } from './types.ts';

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
  installWitness(pi as never, { rules: DEFAULT_RULES });
}
