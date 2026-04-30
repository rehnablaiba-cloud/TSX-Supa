/**
 * queries.testexecution.ts
 *
 * Revision-aware update (2025):
 *  - fetchTestExecution now resolves the active revision for every test in the
 *    module and filters step_results to those that belong to the active revision.
 *    Falls back to revision_id IS NULL rows for tests that have no active revision
 *    yet (legacy / pre-revision data).
 *  - Returns `active_revisions` (all active revisions in the module) and
 *    `current_revision` (the active revision for the module_test_id being opened).
 *  - `current_revision.is_visible === false` means the UI must render read-only.
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
    tests_serial_no: string;
  } | null;
}

export interface RawModuleTestItem {
  id: string;
  tests_name: string;
  test: { serial_no: string; name: string } | null;
}

/** One active revision entry returned alongside execution data. */
export interface ActiveRevision {
  /** test_revisions.id  e.g. "TS-001-R2" */
  id: string;
  /** Human-readable label e.g. "R2" */
  revision: string;
  /** false → UI renders read-only, no pass/fail/undo allowed */
  is_visible: boolean;
  /** FK → tests.serial_no */
  tests_serial_no: string;
}

export interface TestExecutionData {
  module_name: string;
  step_results: RawStepResult[];
  module_tests: RawModuleTestItem[];
  /**
   * Active revision for every test in the module.
   * Keyed by tests_serial_no for O(1) lookup.
   */
  active_revisions: Record<string, ActiveRevision>;
  /**
   * Active revision for the module_test_id that was opened.
   * null when no revision has been activated for this test yet.
   */
  current_revision: ActiveRevision | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchTestExecution
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchTestExecution(
  module_test_id: string
): Promise<TestExecutionData> {
  // ── 1. Resolve module_name + current test serial_no ──────────────────────
  const { data: mtData, error: mtErr } = await supabase
    .from("module_tests")
    .select(
      "module_name, tests_name, test:tests!module_tests_tests_name_fkey(serial_no, name)"
    )
    .eq("id", module_test_id)
    .single();

  if (mtErr) throw mtErr;

  const module_name = (mtData as any)?.module_name ?? "";
  const currentSerialNo: string =
    (mtData as any)?.test?.serial_no ?? "";

  // ── 2. All module_tests in the module ────────────────────────────────────
  const allMtRes = await supabase
    .from("module_tests")
    .select(
      "id, tests_name, test:tests!module_tests_tests_name_fkey(serial_no, name)"
    )
    .eq("module_name", module_name)
    .order("tests_name");

  if (allMtRes.error) throw allMtRes.error;

  const allMts = (allMtRes.data ?? []) as unknown as RawModuleTestItem[];

  // Collect every tests_serial_no present in this module
  const serialNos: string[] = allMts
    .map((mt) => (mt as any).test?.serial_no as string | undefined)
    .filter((s): s is string => !!s);

  // ── 3. Active revisions for every test in the module ────────────────────
  const activeRevisions: Record<string, ActiveRevision> = {};

  if (serialNos.length > 0) {
    const { data: revData, error: revErr } = await supabase
      .from("test_revisions")
      .select("id, revision, is_visible, tests_serial_no")
      .eq("status", "active")
      .in("tests_serial_no", serialNos);

    if (revErr) throw revErr;

    ((revData ?? []) as ActiveRevision[]).forEach((r) => {
      activeRevisions[r.tests_serial_no] = r;
    });
  }

  const current_revision = activeRevisions[currentSerialNo] ?? null;

  // ── 4. Fetch step_results filtered to active revision(s) ─────────────────
  //
  // Strategy:
  //  a) If active revision IDs exist → fetch step_results WHERE revision_id
  //     IN (those IDs). This is the "post-revision" path.
  //  b) Also fetch step_results WHERE revision_id IS NULL for any test that
  //     has no active revision yet (legacy / pre-revision fallback).
  //
  // Both sets are merged; de-duplication is not needed because a step_result
  // row can only match one branch.

  const activeRevisionIds = Object.values(activeRevisions).map((r) => r.id);

  // serial_nos that have NO active revision → need null fallback
  const serialNosWithRevision = new Set(Object.keys(activeRevisions));
  const serialNosWithoutRevision = serialNos.filter(
    (s) => !serialNosWithRevision.has(s)
  );

  const srSelect = `
    id, status, remarks, display_name,
    step:test_steps!step_results_test_steps_id_fkey(
      id, serial_no, action, expected_result, is_divider,
      action_image_urls, expected_image_urls, tests_serial_no
    )
  `;

  const srPromises: Promise<{ data: unknown[] | null; error: unknown }>[] = [];

  // Branch A: rows belonging to an active revision
  if (activeRevisionIds.length > 0) {
    srPromises.push(
      supabase
        .from("step_results")
        .select(srSelect)
        .eq("module_name", module_name)
        .in("revision_id", activeRevisionIds)
        .order("id") as any
    );
  }

  // Branch B: legacy rows (revision_id IS NULL) for tests without a revision
  if (serialNosWithoutRevision.length > 0) {
    srPromises.push(
      supabase
        .from("step_results")
        .select(srSelect)
        .eq("module_name", module_name)
        .is("revision_id", null)
        .order("id") as any
    );
  }

  // If neither branch applies (no tests in module), return empty
  const srResults = await Promise.all(srPromises);

  for (const res of srResults) {
    if ((res as any).error) throw (res as any).error;
  }

  const step_results: RawStepResult[] = srResults.flatMap(
    (r) => ((r as any).data ?? []) as RawStepResult[]
  );

  return {
    module_name,
    step_results,
    module_tests: allMts,
    active_revisions: activeRevisions,
    current_revision,
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
  const { data: existing } = await supabase
    .from("test_locks")
    .select("user_id, locked_by_name")
    .eq("module_test_id", module_test_id)
    .maybeSingle();

  if (existing && (existing as any).user_id !== user_id) {
    return { success: false, holder: (existing as any).locked_by_name };
  }

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

  const { error } = await supabase.from("test_locks").insert({
    module_test_id,
    user_id,
    locked_by_name: display_name,
    locked_at: new Date().toISOString(),
  });

  if (error) {
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
    .eq("user_id", user_id);

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
 * Resets all step results for a specific test within a module.
 * Scoped to the active revision's step IDs when a revision exists.
 */
export async function resetAllStepResults(
  module_name: string,
  tests_name: string
): Promise<void> {
  // Resolve tests_name → serial_no
  const { data: t, error: tErr } = await supabase
    .from("tests")
    .select("serial_no")
    .eq("name", tests_name)
    .single();
  if (tErr) throw tErr;

  const serial_no = (t as any).serial_no as string;

  // Try to scope the reset to the active revision's steps only
  const { data: revData } = await supabase
    .from("test_revisions")
    .select("id, step_order")
    .eq("tests_serial_no", serial_no)
    .eq("status", "active")
    .maybeSingle();

  let stepIds: string[] = [];

  if (revData && Array.isArray((revData as any).step_order)) {
    // Use the ordered step IDs from the active revision
    stepIds = (revData as any).step_order as string[];
  } else {
    // Fallback: all steps for the test
    const { data: steps, error: stepsErr } = await supabase
      .from("test_steps")
      .select("id")
      .eq("tests_serial_no", serial_no);
    if (stepsErr) throw stepsErr;
    stepIds = (steps ?? []).map((s: any) => s.id);
  }

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
