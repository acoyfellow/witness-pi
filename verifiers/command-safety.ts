import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Verdict } from '../src/types.ts';

export type CommandArtifact = {
  kind: string;
  text: string;
  path?: string;
};

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/,
  /glpat-[A-Za-z0-9_-]{16,}/,
  /gh[posru]_[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /Bearer\s+[A-Za-z0-9._-]{20,}/i,
];

const SECRET_PATHS = /(^|\/)(\.env(\.[^/]+)?|\.dev\.vars(\.[^/]+)?|\.npmrc)$/i;

function localDenyPath(): string {
  return (
    process.env.WITNESS_DENY_PATTERNS ?? join(homedir(), '.pi', 'witness', 'deny-patterns.txt')
  );
}

function loadLocalDenies(): RegExp[] {
  const path = localDenyPath();
  if (!existsSync(path)) {
    return [];
  }
  const lines = readFileSync(path, 'utf8').split('\n');
  const out: RegExp[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }
    try {
      out.push(new RegExp(trimmed, 'i'));
    } catch {
      out.push(new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    }
  }
  return out;
}

export function commandSafety(artifact: unknown): Verdict {
  if (!artifact || typeof artifact !== 'object') {
    return { ok: false, detail: 'command-safety: artifact is not an object; blocked' };
  }
  const rec = artifact as CommandArtifact;
  const text = typeof rec.text === 'string' ? rec.text : '';
  const path = typeof rec.path === 'string' ? rec.path : '';
  const kind = typeof rec.kind === 'string' ? rec.kind : 'unknown';

  if (kind === 'bash' && /\bgit\s+commit\b[^\n]*--no-verify\b/i.test(text)) {
    return {
      ok: false,
      detail: 'command-safety: git commit --no-verify is blocked',
    };
  }
  if (kind === 'bash' && /\bgit\s+push\b[^\n]*--force\b/i.test(text) && /\bmain\b/.test(text)) {
    return {
      ok: false,
      detail: 'command-safety: git push --force to main is blocked',
    };
  }
  if (path && SECRET_PATHS.test(path)) {
    return {
      ok: false,
      detail: `command-safety: refuse to write secret-shaped path ${path}`,
    };
  }
  const hay = `${path}\n${text}`;
  for (const rx of SECRET_PATTERNS) {
    if (rx.test(hay)) {
      return {
        ok: false,
        detail: `command-safety: secret-shaped token in ${kind} payload`,
      };
    }
  }
  for (const rx of loadLocalDenies()) {
    if (rx.test(hay)) {
      return {
        ok: false,
        detail: `command-safety: local deny pattern matched in ${kind} payload`,
      };
    }
  }
  return {
    ok: true,
    detail: `command-safety: ${kind} allowed`,
  };
}

export function artifactFromBash(input: Record<string, unknown>): CommandArtifact {
  return { kind: 'bash', text: String(input.command ?? '') };
}

export function artifactFromWrite(input: Record<string, unknown>): CommandArtifact {
  return {
    kind: 'write',
    path: String(input.path ?? ''),
    text: String(input.content ?? input.contents ?? ''),
  };
}

export function artifactFromEdit(input: Record<string, unknown>): CommandArtifact {
  return {
    kind: 'edit',
    path: String(input.path ?? ''),
    text: JSON.stringify(input),
  };
}
