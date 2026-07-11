// Verifier registry. Verifiers are registered by name; the gate resolves
// GateRule.verifiers against this map. Kept deliberately simple: a Map with
// register/get. Where a verifier's code lives (local module or fetched from
// pantry) is the registrant's choice — the registry only holds callables.
//
// IMPORTANT (pantry separation): a verifier fetched from pantry must be
// imported/compiled into a real callable HERE and run in-process. We never
// hand the artifact to `pantry run`. Pantry is the shelf; witness executes.

import type { Verifier } from './types.ts';

const verifiers = new Map<string, Verifier>();

export function register(name: string, fn: Verifier): void {
  if (verifiers.has(name)) {
    throw new Error(`witness: verifier '${name}' already registered`);
  }
  verifiers.set(name, fn);
}

export function get(name: string): Verifier {
  const fn = verifiers.get(name);
  if (!fn) throw new Error(`witness: no verifier named '${name}'`);
  return fn;
}

export function has(name: string): boolean {
  return verifiers.has(name);
}

export function list(): string[] {
  return [...verifiers.keys()];
}

/** Test-only: clear the registry between test cases. */
export function _reset(): void {
  verifiers.clear();
}
