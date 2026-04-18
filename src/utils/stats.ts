// src/utils/stats.ts
// Phase 2 — B5: Pure stat-calculation functions extracted from Dashboard.tsx.
// getModuleStats() and buildSummaries() had zero React dependency —
// they were computing numbers from plain data arrays.
// Moving them here makes them independently unit-testable.

import type { ModuleSummary } from './export';

// Minimal shape needed from DB response — keeps this file independent
// of the full StepResult interface.
interface StepResultLike {
  status: string;
  step?: { is_divider: boolean } | null;
}

interface ModuleTestLike {
  id: string;
}

// ── getModuleStats ─────────────────────────────────────────────────────────────
// Counts pass / fail / pending across a module's step results,
// skipping divider rows. Returns rounded percentages for the progress bar.
export function getModuleStats(
  module_tests: ModuleTestLike[],
  step_results: StepResultLike[]
): {
  total: number; pass: number; fail: number; pending: number;
  passRate: number; failPct: number; pendingPct: number; testCount: number;
} {
  const testCount = module_tests?.length ?? 0;
  let total = 0, pass = 0, fail = 0, pending = 0;

  for (const sr of step_results ?? []) {
    if (sr.step?.is_divider) continue;
    total++;
    if      (sr.status === 'pass') pass++;
    else if (sr.status === 'fail') fail++;
    else                           pending++;
  }

  const passPct    = total > 0 ? Math.round((pass    / total) * 100) : 0;
  const failPct    = total > 0 ? Math.round((fail    / total) * 100) : 0;
  const pendingPct = total > 0 ? 100 - passPct - failPct              : 0;

  return { total, pass, fail, pending, passRate: passPct, failPct, pendingPct, testCount };
}

// ── buildSummaries ─────────────────────────────────────────────────────────────
// Converts the raw modules array (from Supabase joined query) into the
// ModuleSummary shape used by export functions and global stats counters.
export function buildSummaries(modules: any[]): ModuleSummary[] {
  return modules.map(m => {
    const { total, pass, fail, pending, passRate } = getModuleStats(
      m.module_tests ?? [],
      m.step_results ?? []
    );
    return {
      name:        m.name,
      description: m.description,
      total, pass, fail, pending, passRate,
    };
  });
}
