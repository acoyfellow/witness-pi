// Verifier: recipe-backtest (behavioral).
//
// The stronger complement to recipe-safety's static analysis: replay REAL
// historical invocations against the recipe and require the recipe to
// reproduce the exact command that was actually typed, above a fidelity
// threshold. This is what caught repo_status at 36% — a static check never
// would have.
//
// The verifier is given { recipe, cases } where each case is
// { input, expectedCommand }. It runs the recipe code over each input and
// compares (normalized) to the expected command. Pure given its cases; the
// caller supplies cases mined from history.

import type { Verdict } from '../src/types.ts';

export type BacktestCase = { input: Record<string, unknown>; expectedCommand: string };
export type BacktestArtifact = {
  recipe: { name: string; code: string };
  cases: BacktestCase[];
  threshold?: number; // min fidelity to pass, default 0.95
};

function normalize(cmd: string): string {
  return cmd
    .replace(/\/Users\/[^/]+\/cloudflare\//g, '~/cloudflare/')
    .replace(/\s+/g, ' ')
    .trim();
}

function runRecipe(code: string, input: Record<string, unknown>): string {
  // eslint-disable-next-line no-new-func
  const fn = new Function('ctx', code);
  const r = fn({ input }) as { command?: string };
  return String(r?.command ?? '');
}

export function recipeBacktest(artifact: unknown): Verdict {
  const a = artifact as BacktestArtifact | undefined;
  if (!a || !a.recipe || !Array.isArray(a.cases)) {
    return { ok: false, detail: 'artifact must be { recipe, cases[] }' };
  }
  const threshold = a.threshold ?? 0.95;
  let exact = 0;
  const misses: Array<{ expected: string; got: string }> = [];
  for (const c of a.cases) {
    let got: string;
    try {
      got = runRecipe(a.recipe.code, c.input);
    } catch {
      got = '__throw__';
    }
    if (normalize(got) === normalize(c.expectedCommand)) exact++;
    else if (misses.length < 5) misses.push({ expected: c.expectedCommand, got });
  }
  const fidelity = a.cases.length ? exact / a.cases.length : 0;
  const ok = fidelity >= threshold;
  return {
    ok,
    detail: `${a.recipe.name}: ${exact}/${a.cases.length} exact (${(fidelity * 100).toFixed(1)}%), threshold ${(threshold * 100).toFixed(0)}%`,
    evidence: { fidelity, exact, total: a.cases.length, misses },
  };
}
