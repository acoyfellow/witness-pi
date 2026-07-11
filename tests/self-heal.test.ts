import { describe, expect, test } from 'bun:test';
import { type BacktestCase, recipeBacktest } from '../verifiers/recipe-backtest.ts';

// Step 4: the first real self-heal loop, run as a deterministic test.
//
// The benched repo_status recipe failed backtest at 36% because it emits an
// `echo '---'` separator the user never types. This test reproduces that,
// then runs a bounded heal: on a failing verdict, apply the next candidate
// draft, re-verify, cap at 3 attempts. HEALED only when the independent
// backtest verdict passes threshold.

// A representative slice of the real historical cases (the clean, claimable
// shape — status + optional log). The genuinely varied tails (| head,
// --branch) are intentionally NOT claimed; a clean recipe should not pretend
// to own them.
const cases: BacktestCase[] = [
  {
    input: { project: 'alpha', log: 3 },
    expectedCommand: 'cd ~/cloudflare/alpha && git status --short && git log --oneline -3',
  },
  { input: { project: 'beta' }, expectedCommand: 'cd ~/cloudflare/beta && git status --short' },
  {
    input: { project: 'gamma', log: 1 },
    expectedCommand: 'cd ~/cloudflare/gamma && git status --short && git log --oneline -1',
  },
  { input: { project: 'delta' }, expectedCommand: 'cd ~/cloudflare/delta && git status --short' },
  {
    input: { project: 'epsilon', log: 5 },
    expectedCommand: 'cd ~/cloudflare/epsilon && git status --short && git log --oneline -5',
  },
];

// Candidate drafts in heal order. Draft 0 = the benched failure (echo '---').
// Draft 1 = the heal (drop the echo). A deterministic "agent" picks the next
// draft when the verdict fails.
const drafts: string[] = [
  // draft 0: the 36% failure
  "const input=(ctx&&ctx.input)||{};const project=String(input.project||'');const n=input.log!=null?Number(input.log):0;let command='cd ~/cloudflare/'+project+' && git status --short';if(n>0)command+=\" && echo '---' && git log --oneline -\"+n;return{command};",
  // draft 1: heal — drop the echo separator
  "const input=(ctx&&ctx.input)||{};const project=String(input.project||'');const n=input.log!=null?Number(input.log):0;let command='cd ~/cloudflare/'+project+' && git status --short';if(n>0)command+=' && git log --oneline -'+n;return{command};",
];

describe('step 4: bounded self-heal on repo_status', () => {
  test('draft 0 FAILS the independent backtest verdict', () => {
    const v = recipeBacktest({ recipe: { name: 'repo_status', code: drafts[0] }, cases });
    expect(v.ok).toBe(false);
  });

  test('heal loop reaches HEALED within the attempt cap', () => {
    const MAX = 3;
    let attempt = 0;
    let healed = false;
    let lastDetail = '';
    while (attempt < MAX && attempt < drafts.length) {
      const v = recipeBacktest({ recipe: { name: 'repo_status', code: drafts[attempt] }, cases });
      lastDetail = v.detail;
      if (v.ok) {
        healed = true;
        break;
      }
      attempt++; // failing verdict -> next draft (the "heal")
    }
    expect(healed).toBe(true);
    expect(attempt).toBeLessThan(MAX); // healed before exhausting attempts
    expect(lastDetail).toContain('100.0%');
  });

  test('a recipe that cannot reach threshold stays FAILED (honest bench)', () => {
    // Only the broken draft available -> caps out -> not healed.
    const MAX = 3;
    let attempt = 0;
    let healed = false;
    const only = [drafts[0]];
    while (attempt < MAX && attempt < only.length) {
      const v = recipeBacktest({ recipe: { name: 'repo_status', code: only[attempt] }, cases });
      if (v.ok) {
        healed = true;
        break;
      }
      attempt++;
    }
    expect(healed).toBe(false); // correctly refuses to declare success
  });
});
