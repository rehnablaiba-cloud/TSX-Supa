// src/lib/supabase/queries.dashboard.ts
import { supabase } from "../../supabase";
import type { ActiveLock } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DashboardModule {
  name: string;
  description: string | null;
  module_tests: { id: string }[];
  step_results: { status: string; step: { is_divider: boolean } | null }[];
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchDashboardModules
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchDashboardModules(): Promise<DashboardModule[]> {
  const { data, error } = await supabase
    .from("modules")
    .select(
      `
      name, description,
      module_tests:module_tests!module_name(id),
      step_results:step_results!module_name(status, step:test_steps!step_results_test_steps_id_fkey(is_divider))
    `
    )
    .order("name");

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as DashboardModule[];
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchActiveLocks — current user's locks only (used for warning banner)
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
      module_name: mt?.module_name ?? "Unknown Module",
      test_name: mt?.tests_name ?? "Unknown Test",
      locked_at: l.locked_at ?? "",
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchAllActiveLocks — all locks regardless of owner
// Returns a Set of module_names that are locked by someone other than the
// current user, used by Dashboard to show amber on other-locked cards.
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchOtherActiveLockModules(): Promise<Set<string>> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userEmail = sessionData?.session?.user?.email;

  const { data: locks, error } = await supabase
    .from("test_locks")
    .select("module_test_id, locked_by_name");

  if (error || !locks || locks.length === 0) return new Set();

  // Filter to locks NOT owned by current user
  const otherLocks = locks.filter((l: any) => l.locked_by_name !== userEmail);
  if (otherLocks.length === 0) return new Set();

  const module_test_ids = otherLocks.map((l: any) => l.module_test_id);

  const { data: module_tests, error: mtErr } = await supabase
    .from("module_tests")
    .select("id, module_name")
    .in("id", module_test_ids);

  if (mtErr || !module_tests) return new Set();

  return new Set(module_tests.map((mt: any) => mt.module_name));
}
