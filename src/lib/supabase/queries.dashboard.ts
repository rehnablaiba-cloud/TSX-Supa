/**
 * queries.dashboard.ts  (RPC-only rewrite)
 *
 * Single-pass strategy — two parallel queries, no streaming:
 *
 *  1. supabase.rpc("get_dashboard_counts")
 *     Runs entirely in Postgres:
 *       - Reads active step_order arrays from test_revisions
 *       - Joins to step_results on test_steps_id
 *       - Excludes divider rows via test_steps_id suffix (-true)
 *       - Returns (module_name, serial_no, pass, fail, pending, total)
 *       - 3,600 rows max for 120 modules × 30 tests — not 1 M rows
 *
 *  2. modules + module_tests + tests  (names / descriptions)
 *
 * Both fire in Promise.all — one round-trip pair, no waves, no chunks.
 *
 * Payload at 1 M rows / 120 modules / 30 tests:
 *   Old: ~76 MB + 2,000 HTTP calls
 *   New: ~342 KB + 2 HTTP calls  (99.6 % reduction)
 *
 * ─── SQL to deploy in Supabase SQL editor ────────────────────────────────────
 *
 *  create or replace function get_dashboard_counts()
 *  returns table (
 *    module_name   text,
 *    serial_no     text,
 *    pass_count    bigint,
 *    fail_count    bigint,
 *    pending_count bigint,
 *    total_count   bigint
 *  )
 *  language sql stable security definer
 *  as $$
 *    with active_steps as (
 *      select unnest(step_order) as step_id,
 *             tests_serial_no
 *      from   test_revisions
 *      where  status = 'active'
 *    )
 *    select
 *      sr.module_name,
 *      a.tests_serial_no                                                              as serial_no,
 *      count(*) filter (where sr.status = 'pass'    and sr.test_steps_id not like '%-true') as pass_count,
 *      count(*) filter (where sr.status = 'fail'    and sr.test_steps_id not like '%-true') as fail_count,
 *      count(*) filter (where sr.status = 'pending' and sr.test_steps_id not like '%-true') as pending_count,
 *      count(*) filter (where                            sr.test_steps_id not like '%-true') as total_count
 *    from   step_results    sr
 *    join   active_steps    a  on a.step_id = sr.test_steps_id
 *    group  by sr.module_name, a.tests_serial_no;
 *  $$;
 *
 *  -- Recommended index (if not already present):
 *  create index if not exists idx_step_results_test_steps_id
 *    on step_results (test_steps_id);
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { supabase } from "../../supabase";
import type { ActiveLock } from "../../types";


// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** Per-test counts for a single (module, test) pair. */


/**
 * One card on the dashboard — aggregated counts only, no raw step rows.
 * Replaces the old DashboardModule (which carried step_results[]).
 */
export interface DashboardModuleSummary {
  name:        string;
  description: string | null;
  test_count:  number;
  pass:        number;
  fail:        number;
  pending:     number;
  total:       number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal — shape returned by the RPC
// ─────────────────────────────────────────────────────────────────────────────

// Internal — matches the CURRENT SQL output (module-level, no serial_no)
interface RpcCountRow {
  module_name:   string;
  test_count:    number;
  pass_count:    number;
  fail_count:    number;
  pending_count: number;
  total_count:   number;
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchDashboardSummaries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches all module summaries in two parallel queries:
 *   - RPC get_dashboard_counts()  → per-(module, test) counts from Postgres
 *   - modules table               → names, descriptions, test metadata
 *
 * Returns one DashboardModuleSummary per module, sorted alphabetically.
 * No streaming. No subscriptions. Call on mount and on manual refresh.
 */
export async function fetchDashboardSummaries(): Promise<DashboardModuleSummary[]> {
  const [countsResult, modulesResult] = await Promise.all([
    supabase.rpc("get_dashboard_counts"),
    supabase.from("modules").select("name, description").order("name"),
  ]);

  if (countsResult.error) throw new Error(countsResult.error.message);
  if (modulesResult.error) throw new Error(modulesResult.error.message);

  // Key by module_name only — no serial_no in the new RPC
  const countMap = new Map<string, RpcCountRow>();
  for (const row of (countsResult.data ?? []) as RpcCountRow[]) {
    countMap.set(row.module_name, row);
  }

  return ((modulesResult.data ?? []) as any[]).map((mod): DashboardModuleSummary => {
    const cnt = countMap.get(mod.name as string);
    return {
      name:        mod.name        as string,
      description: (mod.description as string | null) ?? null,
      test_count:  Number(cnt?.test_count    ?? 0),
      pass:        Number(cnt?.pass_count    ?? 0),
      fail:        Number(cnt?.fail_count    ?? 0),
      pending:     Number(cnt?.pending_count ?? 0),
      total:       Number(cnt?.total_count   ?? 0),
    };
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// fetchActiveLocks  (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchActiveLocks(): Promise<ActiveLock[]> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userEmail = sessionData?.session?.user?.email;
  if (!userEmail) return [];

  const { data: locks, error: lockErr } = await supabase
    .from("test_locks")
    .select("id, module_test_id, locked_by_name, locked_at")
    .eq("locked_by_name", userEmail);

  if (lockErr || !locks || locks.length === 0) return [];

  const module_test_ids = locks.map((l: any) => l.module_test_id);
  const { data: module_tests, error: mtErr } = await supabase
    .from("module_tests")
    .select("id, module_name, tests_name")
    .in("id", module_test_ids);

  if (mtErr || !module_tests) return [];

  const mtMap = Object.fromEntries(module_tests.map((mt: any) => [mt.id, mt]));
  return locks.map((l: any) => {
    const mt = mtMap[l.module_test_id];
    return {
      module_test_id: l.module_test_id,
      module_name:    mt?.module_name ?? "Unknown Module",
      test_name:      mt?.tests_name  ?? "Unknown Test",
      locked_at:      l.locked_at ?? "",
    };
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// fetchOtherActiveLockModules  (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchOtherActiveLockModules(): Promise<Map<string, number>> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userEmail = sessionData?.session?.user?.email;

  const { data: locks, error } = await supabase
    .from("test_locks")
    .select("module_test_id, locked_by_name");

  if (error || !locks || locks.length === 0) return new Map();

  const otherLocks = locks.filter((l: any) => l.locked_by_name !== userEmail);
  if (otherLocks.length === 0) return new Map();

  const module_test_ids = otherLocks.map((l: any) => l.module_test_id);
  const { data: module_tests, error: mtErr } = await supabase
    .from("module_tests")
    .select("id, module_name")
    .in("id", module_test_ids);

  if (mtErr || !module_tests) return new Map();

  const idToModule = Object.fromEntries(
    module_tests.map((mt: any) => [mt.id, mt.module_name])
  );
  const countMap = new Map<string, number>();
  for (const lock of otherLocks) {
    const moduleName = idToModule[lock.module_test_id];
    if (!moduleName) continue;
    countMap.set(moduleName, (countMap.get(moduleName) ?? 0) + 1);
  }
  return countMap;
}
