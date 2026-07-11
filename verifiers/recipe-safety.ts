// Verifier: recipe-safety.
//
// Gates a pantry recipe push. Rejects recipes whose code or inputSchema invite
// the exact failures this project's history already produced:
//   - path traversal / absolute-path escape in a `project`-style input
//   - shell metacharacters that enable command injection
//   - a hardcoded secret baked into the recipe code
//   - a `machine.shell` capability on a recipe that only returns a string
//     (capability over-declaration — the bug that tripped the first push)
//
// Pure and deterministic: takes the recipe object, returns a Verdict. No I/O.

import type { Verdict } from '../src/types.ts';

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/,
  /glpat-[A-Za-z0-9_-]{16,}/,
  /gh[posru]_[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /Bearer\s+[A-Za-z0-9._-]{20,}/i,
];

export function recipeSafety(artifact: unknown): Verdict {
  const recipe = artifact as Record<string, unknown> | undefined;
  if (!recipe || typeof recipe !== 'object') {
    return { ok: false, detail: 'artifact is not a recipe object' };
  }
  const name = String(recipe.name ?? '(unnamed)');
  const code = typeof recipe.code === 'string' ? recipe.code : '';

  // 1. hardcoded secret in the recipe body
  for (const rx of SECRET_PATTERNS) {
    if (rx.test(code)) {
      return { ok: false, detail: `recipe '${name}' embeds a hardcoded secret (${rx})` };
    }
  }

  // 2. capability over-declaration: declares machine.shell but never uses a
  //    shell binding (only builds/returns a command string).
  const caps = Array.isArray(recipe.capabilities) ? (recipe.capabilities as string[]) : [];
  const usesShellBinding = /\b(machine\.shell|ctx\.bindings|shell\s*\()/.test(code);
  if (caps.includes('machine.shell') && !usesShellBinding) {
    return {
      ok: false,
      detail: `recipe '${name}' declares machine.shell but only returns a string; use workspace.none`,
      evidence: { capabilities: caps },
    };
  }

  // 3. the code must actually guard its project-like inputs. If it interpolates
  //    an input into a command without a traversal/injection check, reject.
  const interpolatesInput =
    /['"`].*\$\{?\s*(input|project)/.test(code) || /\+\s*(project|input)/.test(code);
  const hasTraversalGuard = /\.\.|includes\(['"]\.\.['"]\)|startsWith\(['"]\/['"]\)/.test(code);
  const hasCharAllowlist = /test\(\s*project\s*\)|\/\^\[[^\]]+\]\+\$\//.test(code);
  if (interpolatesInput && !(hasTraversalGuard && hasCharAllowlist)) {
    return {
      ok: false,
      detail: `recipe '${name}' interpolates input into a command without a traversal+allowlist guard`,
    };
  }

  return {
    ok: true,
    detail: `recipe '${name}' passed safety checks`,
    evidence: { capabilities: caps },
  };
}
