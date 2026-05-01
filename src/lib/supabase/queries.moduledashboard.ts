/**
 * queries.moduledashboard.ts  (RPC rewrite — mirrors queries.dashboard.ts)
 *
 * Single-pass strategy — three parallel queries, no streaming, no waves:
 *
 *  1. supabase.rpc("get_module_counts", { p_module_name })
 *     Runs entirely in Postgres — returns (tests_serial_no, pass, fail, pending, total)
 *     for every test in the module. One row per test. No step rows transferred.
 *
 *  2. module_tests + tests   (names, serial_nos, is_visible)
 *
 *  3. test_locks             (for this module's test IDs)
 *
 * All three fire in Promise.all — one round-trip, no phases, no cancellation tokens.
 *
 * Step details (action, expected_result etc.) are only fetched on-demand
 * via fetchModuleStepDetails() when the user triggers CSV/PDF export.
 *
 * ─── SQL to deploy in Supabase SQL editor ────────────────────────────────────
 *
 *  create or replace function get_module_counts(p_module_name text)
 *  returns table (
 *    tests_serial_no text,
 *    pass_count      bigint,
 *    fail_count      bigint,
 *    pending_count   bigint,
 *    total_count     bigint
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
 *      a.tests_serial_no,
 *      count(*) filter (where sr.status = 'pass'    and sr.test_steps_id not like '%-true') as pass_count,
 *      count(*) filter (where sr.status = 'fail'    and sr.test_steps_id not like '%-true') as fail_count,
 *      count(*) filter (where sr.status = 'pending' and sr.test_steps_id not like '%-true') as pending_count,
 *      count(*) filter (where                            sr.test_steps_id not like '%-true') as total_count
 *    from   step_results    sr
 *    join   active_steps    a  on a.step_id = sr.test_steps_id
 *    where  sr.module_name  = p_module_name
 *    group  by a.tests_serial_no;
 *  $$;
 *
 *  -- Recommended index (if not already present):
 *  create index if not exists idx_step_results_module_name
 *    on step_results (module_name);
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { supabase } from "../../supabase";
import type {
  LockRow,
  TrimmedStepResult,
  ModuleTestRow,
  ActiveRevision,
} from "../../components/ModuleDashboard/ModuleDashboard.types";


// ─────────────────────────────────────────────────────────────────────────────
// Internal — shape returned by the RPC
// ─────────────────────────────────────────────────────────────────────────────

interface RpcModuleCountRow {
  tests_serial_no: string;
  pass_count:      number;
  fail_count:      number;
  pending_count:   number;
  total_count:     number;
}


// ─────────────────────────────────────────────────────────────────────────────
// Internal helper
// ─────────────────────────────────────────────────────────────────────────────

function unwrapOne<T>(val: T | T[] | null | undefined): T | null {
  if (val == null) return null;
  if (Array.isArray(val)) return val[0] ?? null;
  return val;
}


// ─────────────────────────────────────────────────────────────────────────────
// fetchModuleData  — main entry point
// ─────────────────────────────────────────────────────────────────────────────

export interface ModuleData {
  module_tests: ModuleTestRow[];
  locks:        Record<string, LockRow>;
  revisions:    Record<string, ActiveRevision>;
}

/**
 * Fetches all data needed to render ModuleDashboard in three parallel queries.
 * Returns counts per test — no raw step rows.
 */
export async function fetchModuleData(module_name: string): Promise<ModuleData> {
  const [countsResult, testsResult, revisionsResult] = await Promise.all([
    supabase.rpc("get_module_counts", { p_module_name: module_name }),
    supabase
      .from("module_tests")
      .select("id, tests_name, is_visible, test:tests!module_tests_tests_name_fkey(serial_no, name)")
      .eq("module_name", module_name),
    supabase
      .from("test_revisions")
      .select("id, revision, tests_serial_no, step_order")
      .eq("status", "active"),
  ]);

  if (countsResult.error) throw new Error(countsResult.error.message);
  if (testsResult.error)  throw new Error(testsResult.error.message);
  if (revisionsResult.error) throw new Error(revisionsResult.error.message);

  // ── Count map keyed by tests_serial_no ──────────────────────────────────
  const countMap = new Map<string, RpcModuleCountRow>();
  for (const row of (countsResult.data ?? []) as RpcModuleCountRow[]) {
    countMap.set(row.tests_serial_no, row);
  }

  // ── Revision map ─────────────────────────────────────────────────────────
  const revisions: Record<string, ActiveRevision> = {};
  for (const r of (revisionsResult.data ?? []) as any[]) {
    revisions[r.tests_serial_no] = {
      id:         r.id,
      revision:   r.revision,
      step_order: Array.isArray(r.step_order) ? (r.step_order as string[]) : [],
    };
  }

  // ── Build ModuleTestRow[] ─────────────────────────────────────────────────
  const module_tests: ModuleTestRow[] = ((testsResult.data ?? []) as any[])
    .map((mt): ModuleTestRow => {
      const test   = unwrapOne(mt.test) as { serial_no: string; name: string } | null;
      const counts = test?.serial_no ? countMap.get(test.serial_no) : undefined;
      return {
        id:         mt.id         as string,
        tests_name: mt.tests_name as string,
        is_visible: (mt.is_visible ?? true) as boolean,
        test,
        pass:    Number(counts?.pass_count    ?? 0),
        fail:    Number(counts?.fail_count    ?? 0),
        pending: Number(counts?.pending_count ?? 0),
        total:   Number(counts?.total_count   ?? 0),
      };
    })
    .sort((a, b) => {
      const aS = a.test?.serial_no ?? "";
      const bS = b.test?.serial_no ?? "";
      return aS.localeCompare(bS, undefined, { numeric: true, sensitivity: "base" });
    });

  // ── Lock map ──────────────────────────────────────────────────────────────
  const locks: Record<string, LockRow> = {};
  const moduleTestIds = module_tests.map((mt) => mt.id);

  if (moduleTestIds.length > 0) {
    const { data: lockData, error: lockErr } = await supabase
      .from("test_locks")
      .select("module_test_id, user_id, locked_by_name, locked_at")
      .in("module_test_id", moduleTestIds);

    if (!lockErr && lockData) {
      for (const l of lockData as LockRow[]) {
        locks[l.module_test_id] = l;
      }
    }
  }

  return { module_tests, locks, revisions };
}


// ─────────────────────────────────────────────────────────────────────────────
// fetchModuleLocks  (Realtime lock refresh — lightweight, unchanged)
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchModuleLocks(
  moduleTestIds: string[]
): Promise<Record<string, LockRow>> {
  if (moduleTestIds.length === 0) return {};
  const { data, error } = await supabase
    .from("test_locks")
    .select("module_test_id, user_id, locked_by_name, locked_at")
    .in("module_test_id", moduleTestIds);
  if (error) throw new Error(error.message);
  const map: Record<string, LockRow> = {};
  for (const l of (data ?? []) as LockRow[]) {
    map[l.module_test_id] = l;
  }
  return map;
}


// ─────────────────────────────────────────────────────────────────────────────
// fetchModuleStepDetails  (export-only — lazy, not called during render)
// ─────────────────────────────────────────────────────────────────────────────

const STEP_RESULT_SELECT =
  "id, status, test_steps_id, step:test_steps!step_results_test_steps_id_fkey(id, is_divider, tests_serial_no, serial_no, action, expected_result)";

/**
 * Fetches full step-result rows for export (CSV / PDF).
 * Only called when the user opens the export modal and confirms.
 * Groups results by tests_serial_no for easy FlatData construction.
 */
export async function fetchModuleStepDetails(
  module_name: string
): Promise<Record<string, TrimmedStepResult[]>> {
  const { data, error } = await supabase
    .from("step_results")
    .select(STEP_RESULT_SELECT)
    .eq("module_name", module_name);

  if (error) throw new Error(error.message);

  const bySerial: Record<string, TrimmedStepResult[]> = {};
  for (const row of data ?? []) {
    const step = (Array.isArray(row.step) ? row.step[0] : row.step) as TrimmedStepResult["step"];
    if (!step) continue;
    const key = step.tests_serial_no;
    (bySerial[key] ??= []).push({ id: row.id, status: row.status, step });
  }
  return bySerial;
}