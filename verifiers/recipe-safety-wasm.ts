import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Verdict } from '../src/types.ts';

const DETAIL: Record<number, string> = {
  0: 'passed safety checks',
  1: 'artifact is not a recipe object',
  2: 'recipe has no string code to check; blocked (unrecognized recipe shape)',
  3: 'push carries an array, not a single recipe object; blocked (cannot check each)',
  4: 'recipe is not valid utf-8; blocked',
  5: 'recipe embeds a hardcoded secret',
  6: 'recipe looks like a split/concatenated secret prefix',
  7: 'recipe declares machine.shell without an executable shell binding',
  8: 'recipe loads child_process without machine.exec',
  9: 'recipe interpolates input into a command without a traversal+allowlist guard',
};

const here = dirname(fileURLToPath(import.meta.url));
const wasmDir = join(here, '..', 'wasm');
const wasmPath = join(wasmDir, 'recipe_safety.wasm');
const hashPath = join(wasmDir, 'recipe_safety.sha256');

export function wasmArtifactPaths(): { wasmPath: string; hashPath: string } {
  return { wasmPath, hashPath };
}

export function wasmReady(): boolean {
  return existsSync(wasmPath) && existsSync(hashPath);
}

function loadEngine(): {
  memory: WebAssembly.Memory;
  ptr: () => number;
  cap: () => number;
  validate: (len: number) => number;
  sha256: string;
} {
  const wasmBytes = readFileSync(wasmPath);
  const expected = readFileSync(hashPath, 'utf8').trim();
  const actual = createHash('sha256').update(wasmBytes).digest('hex');
  if (actual !== expected) {
    throw new Error(`recipe-safety.wasm sha256 mismatch: expected ${expected}, got ${actual}`);
  }
  const instance = new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), {});
  const exports = instance.exports as {
    memory: WebAssembly.Memory;
    recipe_safety_input_ptr: () => number;
    recipe_safety_input_capacity: () => number;
    recipe_safety_validate: (len: number) => number;
  };
  return {
    memory: exports.memory,
    ptr: exports.recipe_safety_input_ptr,
    cap: exports.recipe_safety_input_capacity,
    validate: exports.recipe_safety_validate,
    sha256: actual,
  };
}

let engine: ReturnType<typeof loadEngine> | null = null;

function getEngine(): ReturnType<typeof loadEngine> {
  if (!engine) {
    engine = loadEngine();
  }
  return engine;
}

export function recipeSafetyWasm(artifact: unknown): Verdict {
  if (!wasmReady()) {
    return {
      ok: false,
      detail: 'recipe-safety.wasm missing; run ./wasm/build.sh (fail closed)',
    };
  }
  let engineInstance: ReturnType<typeof loadEngine>;
  try {
    engineInstance = getEngine();
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  let whole: string;
  try {
    whole = JSON.stringify(artifact);
  } catch {
    return { ok: false, detail: 'recipe is not stably serializable; blocked' };
  }
  if (typeof whole !== 'string') {
    return { ok: false, detail: 'recipe is not stably serializable; blocked' };
  }
  const bytes = Buffer.from(whole, 'utf8');
  const cap = engineInstance.cap();
  if (bytes.length > cap) {
    return { ok: false, detail: 'recipe exceeds wasm input capacity; blocked' };
  }
  new Uint8Array(engineInstance.memory.buffer, engineInstance.ptr(), bytes.length).set(bytes);
  const code = engineInstance.validate(bytes.length);
  const ok = code === 0;
  const name =
    artifact && typeof artifact === 'object' && 'name' in artifact
      ? String((artifact as { name?: unknown }).name ?? '(unnamed)')
      : '(unnamed)';
  return {
    ok,
    detail: ok
      ? `recipe '${name}' passed safety checks`
      : `recipe '${name}' ${DETAIL[code] ?? `blocked (code ${code})`}`,
    evidence: { checker: 'recipe-safety-wasm', sha256: engineInstance.sha256, code },
  };
}
