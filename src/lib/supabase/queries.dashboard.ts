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
      step_results:step_results!module_name(status, step:steps(is_divider))
    `
    )
    .order("name");

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as DashboardModule[];
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchActiveLocks
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
