// Verifier: recipe-safety.
//
// Gates a pantry recipe push. Rejects recipes whose code or inputSchema invite
// the exact failures this project's history already produced:
//   - path traversal / absolute-path escape in a `project`-style input
//   - shell metacharacters that enable command injection
//   - a hardcoded secret baked into the recipe code
//   - a `machine.shell` capability with no executable shell binding
//     (capability over-declaration — return shape alone is not evidence)
//
// SCOPE (honest): this is a cheap SYNTACTIC SCREEN, not a secret scanner or
// sandbox. It catches the honest mistake (paste a key), one common evasion
// (splitting a prefix across a `+`), and capability mismatches visible in
// executable tokens. A motivated evader (base64, char codes, fetch-at-runtime)
// will get past it. Do not rely on it to stop exfiltration.
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

// Remove comments and quoted literals before making capability-use claims.
// Literal values are intentionally retained by removeCommentsOnly below when
// checking approved module loads; a docstring saying "machine.shell()" must not
// count as an executable host call.
function removeCommentsAndStrings(code: string): string {
  let out = '';
  let quote: "'" | '"' | '`' | null = null;
  let escaped = false;
  for (let i = 0; i < code.length; i++) {
    const char = code[i];
    const next = code[i + 1];
    if (!quote && char === '/' && next === '/') {
      out += '  ';
      i += 1;
      while (i + 1 < code.length && code[i + 1] !== '\\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (!quote && char === '/' && next === '*') {
      out += '  ';
      i += 1;
      while (i + 1 < code.length && !(code[i + 1] === '*' && code[i + 2] === '/')) {
        out += code[i + 1] === '\\n' ? '\\n' : ' ';
        i += 1;
      }
      if (i + 2 < code.length) {
        out += '  ';
        i += 2;
      }
      continue;
    }
    if (quote) {
      out += char === '\\n' ? '\\n' : ' ';
      if (escaped) escaped = false;
      else if (char === '\\\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      escaped = false;
      out += ' ';
      continue;
    }
    out += char;
  }
  return out;
}

function removeCommentsOnly(code: string): string {
  return code.replace(/\/\/[^\\n]*|\/\\*[\\s\\S]*?\\*\//g, ' ');
}

export function recipeSafety(artifact: unknown): Verdict {
  // FAIL CLOSED (RB-1): anything that isn't a single checkable recipe object is
  // BLOCKED, not passed. An array of recipes, a code-less object, or a shape
  // this verifier can't read must never slip through to ALLOW.
  if (Array.isArray(artifact)) {
    return {
      ok: false,
      detail: 'push carries an array, not a single recipe object; blocked (cannot check each)',
    };
  }
  const recipe = artifact as Record<string, unknown> | undefined;
  if (!recipe || typeof recipe !== 'object') {
    return { ok: false, detail: 'artifact is not a recipe object' };
  }
  if (typeof recipe.code !== 'string') {
    return {
      ok: false,
      detail: "recipe has no string 'code' to check; blocked (unrecognized recipe shape)",
    };
  }
  const name = String(recipe.name ?? '(unnamed)');
  const code = recipe.code;

  // 1. hardcoded secret ANYWHERE in the recipe, not just `code` (a secret in
  //    description / inputSchema / any field is still a leaked secret). Scan a
  //    stable serialization of the whole recipe. Snapshot ONCE so a getter/Proxy
  //    can't show clean bytes to the scan and dirty bytes later (TOCTOU).
  let whole: string;
  try {
    whole = JSON.stringify(recipe);
  } catch {
    return { ok: false, detail: `recipe '${name}' is not stably serializable; blocked` };
  }
  if (typeof whole !== 'string') {
    return { ok: false, detail: `recipe '${name}' is not stably serializable; blocked` };
  }
  for (const rx of SECRET_PATTERNS) {
    if (rx.test(whole)) {
      return { ok: false, detail: `recipe '${name}' embeds a hardcoded secret (${rx})` };
    }
  }

  // 1b. cheap evasion: a secret PREFIX split across string concatenation, e.g.
  //     "sk-" + "AAAA...". Best-effort only (see SCOPE note above).
  const splitPrefix = /["'`](sk-|glpat-|ghp_|Bearer\s*)["'`]\s*\+/i;
  if (splitPrefix.test(code)) {
    return {
      ok: false,
      detail: `recipe '${name}' looks like a split/concatenated secret prefix (evasion of the secret check)`,
    };
  }

  // 2. Capability checks must follow executable host use, not the returned
  //    value. Returning a string or parsed JSON after a shell call is still a
  //    legitimate machine.shell recipe. Comments/docstrings/string literals
  //    are removed before this check to avoid witness false positives.
  const caps = Array.isArray(recipe.capabilities) ? (recipe.capabilities as string[]) : [];
  const executableCode = removeCommentsAndStrings(code);
  const codeWithoutComments = removeCommentsOnly(code);
  const usesShellBinding =
    /\bmachine\s*\.\s*shell\s*\(/.test(executableCode) ||
    /\bctx\s*\.\s*bindings\s*(?:\.\s*machine\s*)?\.\s*shell\s*\(/.test(executableCode);
  const loadsChildProcess =
    /\b(?:ctx\s*\.\s*)?require\s*\(\s*['"`]node:child_process['"`]\s*\)/.test(
      codeWithoutComments,
    ) || /\bimport\s*\(\s*['"`]node:child_process['"`]\s*\)/.test(codeWithoutComments);
  if (caps.includes('machine.shell') && !usesShellBinding) {
    const detail = loadsChildProcess
      ? `recipe '${name}' uses direct child_process access but declares machine.shell; declare machine.exec or use the machine.shell binding`
      : `recipe '${name}' declares machine.shell without an executable shell binding; use workspace.none only when no host access is required`;
    return { ok: false, detail, evidence: { capabilities: caps, loadsChildProcess } };
  }
  if (loadsChildProcess && !caps.includes('machine.exec')) {
    return {
      ok: false,
      detail: `recipe '${name}' loads child_process without machine.exec; direct subprocess access requires the sanctioned machine.exec capability`,
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
