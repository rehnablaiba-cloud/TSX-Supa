/**
 * queries.testexecution.ts
 *
 * Step-order-aware data fetch (revised):
 *  - fetchTestExecution resolves the active revision for the opened test, reads
 *    its `step_order` array (ordered list of test_steps IDs), then fetches
 *    test_steps + step_results **by those IDs only**.  revision_id is NOT used
 *    as a filter on step_results; the step_order array is the sole source of
 *    truth for which rows to show and in what order.
 *  - Falls back to serial_no ordering when no active revision exists.
 *  - Returns `step_results` pre-sorted to match step_order so callers can
 *    assign display serial numbers directly from array index.
 *  - Returns `current_revision` (the active revision for the opened test) and
 *    `active_revisions` keyed by tests_serial_no for the whole module.
 *  - is_visible now lives on module_tests (not test_revisions).
 *    `is_visible === false` → render read-only.
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
  is_visible: boolean; // ✅ moved here from ActiveRevision
  test: { serial_no: string; name: string } | null;
}


/** One active revision entry returned alongside execution data. */
export interface ActiveRevision {
  /** test_revisions.id  e.g. "TS-001-R2" */
  id: string;
  /** Human-readable label e.g. "R2" */
  revision: string;
  // ✅ is_visible removed — now lives on RawModuleTestItem
  /** FK → tests.serial_no */
  tests_serial_no: string;
}


export interface TestExecutionData {
  module_name: string;
  /**
   * Step results pre-ordered to match the active revision's step_order array.
   * Each entry is guaranteed to have a non-null `step` field.
   * Callers should use the array index (+ 1) as the display serial number,
   * not step.serial_no.
   */
  step_results: RawStepResult[];
  module_tests: RawModuleTestItem[];
  /**
   * Active revision for every test in the module, keyed by tests_serial_no.
   */
  active_revisions: Record<string, ActiveRevision>;
  /**
   * Active revision for the module_test_id that was opened.
   * null when no revision has been activated for this test yet.
   */
  current_revision: ActiveRevision | null;
  /**
   * Whether the opened module_test is editable.
   * false → render read-only; sourced from module_tests.is_visible.
   */
  is_visible: boolean; // ✅ added to top-level return
}


// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────


const STEP_SELECT =
  "id, serial_no, action, expected_result, is_divider, action_image_urls, expected_image_urls, tests_serial_no";


const SR_SELECT = "id, status, remarks, display_name, test_steps_id";


function buildStepResult(
  step: any,
  sr: any | undefined
): RawStepResult {
  return {
    id: sr?.id ?? "",
    status: (sr?.status ?? "pending") as "pass" | "fail" | "pending",
    remarks: sr?.remarks ?? "",
    display_name: sr?.display_name ?? "",
    step: {
      id: step.id,
      serial_no: step.serial_no,
      action: step.action,
      expected_result: step.expected_result,
      is_divider: step.is_divider,
      action_image_urls: step.action_image_urls ?? [],
      expected_image_urls: step.expected_image_urls ?? [],
      tests_serial_no: step.tests_serial_no,
    },
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// fetchTestExecution
// ─────────────────────────────────────────────────────────────────────────────


export async function fetchTestExecution(
  module_test_id: string
): Promise<TestExecutionData> {
  // ── 1. Resolve module_name + current test serial_no + is_visible ─────────
  const { data: mtData, error: mtErr } = await supabase
    .from("module_tests")
    .select(
      // ✅ is_visible added here
      "module_name, tests_name, is_visible, test:tests!module_tests_tests_name_fkey(serial_no, name)"
    )
    .eq("id", module_test_id)
    .single();
  if (mtErr) throw mtErr;

  const module_name: string = (mtData as any)?.module_name ?? "";
  const currentSerialNo: string = (mtData as any)?.test?.serial_no ?? "";
  const is_visible: boolean = (mtData as any)?.is_visible ?? true; // ✅ extracted here


  // ── 2. All module_tests in the module ────────────────────────────────────
  const allMtRes = await supabase
    .from("module_tests")
    .select(
      // ✅ is_visible added here
      "id, tests_name, is_visible, test:tests!module_tests_tests_name_fkey(serial_no, name)"
    )
    .eq("module_name", module_name)
    .order("tests_name");
  if (allMtRes.error) throw allMtRes.error;

  const allMts = (allMtRes.data ?? []) as unknown as RawModuleTestItem[];
  const serialNos: string[] = allMts
    .map((mt) => (mt as any).test?.serial_no as string | undefined)
    .filter((s): s is string => !!s);


  // ── 3. Active revisions for all tests in the module ──────────────────────
  const activeRevisions: Record<string, ActiveRevision> = {};
  let stepOrder: string[] | null = null;

  if (serialNos.length > 0) {
    const { data: revData, error: revErr } = await supabase
      .from("test_revisions")
      .select("id, revision, tests_serial_no, step_order") // ✅ is_visible removed
      .eq("status", "active")
      .in("tests_serial_no", serialNos);
    if (revErr) throw revErr;

    ((revData ?? []) as any[]).forEach((r) => {
      activeRevisions[r.tests_serial_no] = {
        id: r.id,
        revision: r.revision,
        // ✅ is_visible no longer mapped here
        tests_serial_no: r.tests_serial_no,
      };
      if (
        r.tests_serial_no === currentSerialNo &&
        Array.isArray(r.step_order) &&
        r.step_order.length > 0
      ) {
        stepOrder = r.step_order as string[];
      }
    });
  }

  const current_revision = activeRevisions[currentSerialNo] ?? null;

  // ✅ Snapshot let into const after all awaits — prevents TS narrowing reset
  const resolvedStepOrder = stepOrder as string[] | null;


  // ── 4a. Revision path ─────────────────────────────────────────────────────
  if (resolvedStepOrder !== null && resolvedStepOrder.length > 0) {
    const orderedIds: string[] = resolvedStepOrder;

    const [stepsRes, srRes] = await Promise.all([
      supabase
        .from("test_steps")
        .select(STEP_SELECT)
        .in("id", orderedIds),
      supabase
        .from("step_results")
        .select(SR_SELECT)
        .eq("module_name", module_name)
        .in("test_steps_id", orderedIds),
    ]);
    if (stepsRes.error) throw stepsRes.error;
    if (srRes.error) throw srRes.error;

    const stepsById: Record<string, any> = {};
    ((stepsRes.data ?? []) as any[]).forEach((s) => { stepsById[s.id] = s; });

    const srByStepId: Record<string, any> = {};
    ((srRes.data ?? []) as any[]).forEach((sr) => { srByStepId[sr.test_steps_id] = sr; });

    const step_results: RawStepResult[] = orderedIds
      .map((stepId: string) => {
        const step = stepsById[stepId];
        if (!step) return null;
        return buildStepResult(step, srByStepId[stepId]);
      })
      .filter((sr: RawStepResult | null): sr is RawStepResult => sr !== null);

    return {
      module_name,
      step_results,
      module_tests: allMts,
      active_revisions: activeRevisions,
      current_revision,
      is_visible, // ✅
    };
  }


  // ── 4b. Fallback path — no active revision ────────────────────────────────
  if (!currentSerialNo) {
    return {
      module_name,
      step_results: [],
      module_tests: allMts,
      active_revisions: activeRevisions,
      current_revision: null,
      is_visible, // ✅
    };
  }

  const { data: stepsData, error: stepsErr } = await supabase
    .from("test_steps")
    .select(STEP_SELECT)
    .eq("tests_serial_no", currentSerialNo)
    .order("serial_no");
  if (stepsErr) throw stepsErr;

  const fallbackStepIds = ((stepsData ?? []) as any[]).map((s) => s.id as string);

  if (!fallbackStepIds.length) {
    return {
      module_name,
      step_results: [],
      module_tests: allMts,
      active_revisions: activeRevisions,
      current_revision: null,
      is_visible, // ✅
    };
  }

  const { data: srData, error: srErr } = await supabase
    .from("step_results")
    .select(SR_SELECT)
    .eq("module_name", module_name)
    .in("test_steps_id", fallbackStepIds);
  if (srErr) throw srErr;

  const srByStepId: Record<string, any> = {};
  ((srData ?? []) as any[]).forEach((sr) => { srByStepId[sr.test_steps_id] = sr; });

  const step_results: RawStepResult[] = ((stepsData ?? []) as any[])
    .map((step) => buildStepResult(step, srByStepId[step.id]))
    .filter((sr: RawStepResult | null): sr is RawStepResult => sr !== null);

  return {
    module_name,
    step_results,
    module_tests: allMts,
    active_revisions: activeRevisions,
    current_revision: null,
    is_visible, // ✅
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
 * Call every ~15 s while the user is in execution.
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
 * Accepts the step_result row IDs directly (already scoped by the caller).
 */
export async function resetAllStepResults(
  module_name: string,
  stepResultIds: string[],
  display_name: string
): Promise<void> {
  if (!stepResultIds.length) return;
  const { error } = await supabase
    .from("step_results")
    .update({ status: "pending", remarks: "", display_name })
    .in("id", stepResultIds);
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

  // ✅ Batch call instead of one-by-one for better performance
  const { data, error } = await supabase.storage
    .from("test_steps")
    .createSignedUrls(unique, 3600);

  if (error || !data) return {};

  return Object.fromEntries(
    data
      .filter((entry) => !!entry.signedUrl)
      .map((entry) => [entry.path, entry.signedUrl!])
  );
}