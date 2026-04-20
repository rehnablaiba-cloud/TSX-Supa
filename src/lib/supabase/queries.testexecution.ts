/**
 * queries.testexecution.ts
 */
import { supabase } from "../../supabase";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RawStepResult {
  id: string;
  status: "pass" | "fail" | "pending";
  remarks: string;
  display_name: string;
  step: {
    id: string;
    serial_no: number;
    action: string;
    expected_result: string;
    is_divider: boolean;
    action_image_urls: string[];
    expected_image_urls: string[];
    tests_name: string;
  } | null;
}

export interface RawModuleTestItem {
  id: string;
  tests_name: string;
  test: { serial_no: string; name: string } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchTestExecution
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchTestExecution(module_test_id: string): Promise<{
  step_results: RawStepResult[];
  module_tests: RawModuleTestItem[];
  module_name: string;
}> {
  const { data: mtData, error: mtErr } = await supabase
    .from("module_tests")
    .select("module_name")
    .eq("id", module_test_id)
    .single();

  if (mtErr) throw mtErr;

  const module_name = (mtData as any)?.module_name ?? "";

  const [srRes, allMtRes] = await Promise.all([
    supabase
      .from("step_results")
      .select(
        `
        id, status, remarks, display_name,
        step:test_steps!step_results_test_steps_id_fkey(
          id, serial_no, action, expected_result, is_divider,
          action_image_urls, expected_image_urls, tests_name
        )
      `
      )
      .eq("module_name", module_name)
      .order("id"),
    supabase
      .from("module_tests")
      .select(
        "id, tests_name, test:tests!module_tests_tests_name_fkey(serial_no, name)"
      )
      .eq("module_name", module_name)
      .order("tests_name"),
  ]);

  if (srRes.error) throw srRes.error;
  if (allMtRes.error) throw allMtRes.error;

  return {
    module_name,
    step_results: (srRes.data ?? []) as unknown as RawStepResult[],
    module_tests: (allMtRes.data ?? []) as unknown as RawModuleTestItem[],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lock management
// ─────────────────────────────────────────────────────────────────────────────

export async function acquireLock(
  module_test_id: string,
  user_id: string,
  display_name: string
): Promise<{ success: boolean; holder?: string }> {
  // ── Step 1: Read current lock state ───────────────────────────────────────
  const { data: existing } = await supabase
    .from("test_locks")
    .select("user_id, locked_by_name")
    .eq("module_test_id", module_test_id)
    .maybeSingle();

  // ── Step 2: Lock held by someone else — refuse completely ─────────────────
  if (existing && (existing as any).user_id !== user_id) {
    return { success: false, holder: (existing as any).locked_by_name };
  }

  // ── Step 3: We already own this lock — just refresh the timestamp ─────────
  if (existing && (existing as any).user_id === user_id) {
    const { error } = await supabase
      .from("test_locks")
      .update({
        locked_by_name: display_name,
        locked_at: new Date().toISOString(),
      })
      .eq("module_test_id", module_test_id)
      .eq("user_id", user_id);

    if (error) {
      console.error("[acquireLock] refresh error:", error.message);
      return { success: false };
    }
    return { success: true };
  }

  // ── Step 4: No lock exists — insert fresh (no upsert — avoids race) ───────
  const { error } = await supabase.from("test_locks").insert({
    module_test_id,
    user_id,
    locked_by_name: display_name,
    locked_at: new Date().toISOString(),
  });

  // If insert fails due to unique constraint race (another user got in first)
  if (error) {
    // Re-read to return the actual holder's name
    const { data: winner } = await supabase
      .from("test_locks")
      .select("user_id, locked_by_name")
      .eq("module_test_id", module_test_id)
      .maybeSingle();

    const holder = (winner as any)?.locked_by_name;
    console.warn("[acquireLock] lost race to:", holder);
    return { success: false, holder };
  }

  return { success: true };
}

export async function releaseLock(
  module_test_id: string,
  user_id: string
): Promise<void> {
  const { error } = await supabase
    .from("test_locks")
    .delete()
    .eq("module_test_id", module_test_id)
    .eq("user_id", user_id); // Only releases YOUR own lock

  if (error) console.error("[releaseLock]", error.message);
}

export async function forceReleaseLock(module_test_id: string): Promise<void> {
  const { error } = await supabase
    .from("test_locks")
    .delete()
    .eq("module_test_id", module_test_id);

  if (error) console.error("[forceReleaseLock]", error.message);
}

/**
 * Refreshes locked_at timestamp to keep the lock alive.
 * Called every 15s while user is in execution.
 * Only updates if we still own the lock (user_id guard).
 */
export async function heartbeatLock(
  module_test_id: string,
  user_id: string
): Promise<void> {
  const { error } = await supabase
    .from("test_locks")
    .update({ locked_at: new Date().toISOString() })
    .eq("module_test_id", module_test_id)
    .eq("user_id", user_id);

  if (error) console.error("[heartbeatLock]", error.message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step results
// ─────────────────────────────────────────────────────────────────────────────

export async function upsertStepResult(payload: {
  test_steps_id: string;
  module_name: string;
  status: "pass" | "fail" | "pending";
  remarks: string;
  display_name: string;
}): Promise<void> {
  const { error } = await supabase
    .from("step_results")
    .update({
      status: payload.status,
      remarks: payload.remarks,
      display_name: payload.display_name,
    })
    .eq("test_steps_id", payload.test_steps_id)
    .eq("module_name", payload.module_name);

  if (error) throw error;
}

/**
 * Resets all step results for a specific tests_name within a module.
 * Scoped to tests_name — prevents wiping other tests in the same module.
 */
export async function resetAllStepResults(
  module_name: string,
  tests_name: string
): Promise<void> {
  const { data: steps, error: stepsErr } = await supabase
    .from("test_steps")
    .select("id")
    .eq("tests_name", tests_name);

  if (stepsErr) throw stepsErr;

  const stepIds = (steps ?? []).map((s: any) => s.id);
  if (!stepIds.length) return;

  const { error } = await supabase
    .from("step_results")
    .update({ status: "pending", remarks: "", display_name: "" })
    .eq("module_name", module_name)
    .in("test_steps_id", stepIds);

  if (error) throw error;
}

// ─────────────────────────────────────────────────────────────────────────────
// Signed image URLs
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchSignedUrls(
  paths: string[]
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (!unique.length) return {};

  const result: Record<string, string> = {};
  await Promise.all(
    unique.map(async (path) => {
      const { data } = await supabase.storage
        .from("test_steps")
        .createSignedUrl(path, 3600);
      if (data?.signedUrl) result[path] = data.signedUrl;
    })
  );
  return result;
}
