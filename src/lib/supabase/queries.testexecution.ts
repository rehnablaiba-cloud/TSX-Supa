/**
 * queries.testexecution.ts
 *
 * Two-phase loading strategy (single test):
 *
 *  Phase 1 — fetchTestExecutionShell(module_test_id)
 *    Fetches module_test metadata + active revisions + all module_tests
 *    + step definitions (test_steps).
 *    Returns a shell with step_results pre-populated as "pending" so the
 *    full step list renders immediately without waiting for the DB.
 *
 *  Phase 2 — streamTestStepResults(shell, onBatch, signal?, token?)
 *    Streams real step_result rows in parallel waves:
 *    500 step IDs per request, up to 100 concurrent per wave.
 *    onBatch() fires after each wave with fully updated RawStepResult[].
 *    Accepts a cancellation token so superseded fetches abort cleanly.
 *
 * FIXES (5k step support):
 *  - fetchTestExecutionShell: step definitions now batched (500/req) so
 *    .in("id", [...5000 ids]) never blows the URL size limit.
 *  - streamTestStepResults: abortSignal(signal!) replaced with a safe guard
 *    so undefined is never passed to the Supabase client.
 *  - fetchSignedUrls: always uses createSignedUrls (batch) instead of the
 *    per-path createSignedUrl loop that fired thousands of HTTP requests.
 *  - fetchTestExecution (legacy): step-def fetch is now batched too.
 */
import { supabase } from "../../supabase";


// ─────────────────────────────────────────────────────────────────────────────
// Public types
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
  is_visible: boolean;
  test: { serial_no: string; name: string } | null;
}

export interface ActiveRevision {
  id: string;
  revision: string;
  tests_serial_no: string;
}

/**
 * Result of Phase 1. Pass the whole object to streamTestStepResults().
 * _internal fields are opaque — do not read them outside this module.
 */
export interface TestExecutionShell {
  module_name: string;
  is_visible: boolean;
  current_revision: ActiveRevision | null;
  active_revisions: Record<string, ActiveRevision>;
  module_tests: RawModuleTestItem[];
  /**
   * Step results pre-ordered to match the active revision's step_order (or
   * serial_no order for the fallback path). Status is "pending" for every row
   * until Phase 2 fills in real values.
   */
  step_results: RawStepResult[];

  /** @internal Ordered step IDs (from step_order or serial_no sort). */
  _orderedStepIds: string[];
  /** @internal Step definitions keyed by step ID. */
  _stepsById: Record<string, RawStepDef>;
}

/** Legacy return type kept for callers that still use fetchTestExecution directly. */
export interface TestExecutionData {
  module_name: string;
  step_results: RawStepResult[];
  module_tests: RawModuleTestItem[];
  active_revisions: Record<string, ActiveRevision>;
  current_revision: ActiveRevision | null;
  is_visible: boolean;
}

/** Lightweight cancellation token. */
export interface StreamCancellationToken {
  cancelled: boolean;
}


// ─────────────────────────────────────────────────────────────────────────────
// Internal types & constants
// ─────────────────────────────────────────────────────────────────────────────

interface RawStepDef {
  id: string;
  serial_no: number;
  action: string;
  expected_result: string;
  is_divider: boolean;
  action_image_urls: string[];
  expected_image_urls: string[];
  tests_serial_no: string;
}

interface RawSrRow {
  id: string;
  status: "pass" | "fail" | "pending";
  remarks: string;
  display_name: string;
  test_steps_id: string;
}

/** Step IDs per Supabase request — keeps URL well under limits at any scale. */
const BATCH_SIZE = 500;
/** Max concurrent requests per wave. onBatch() fires once per wave. */
const WAVE_SIZE  = 100;

const STEP_SELECT =
  "id, serial_no, action, expected_result, is_divider, action_image_urls, expected_image_urls, tests_serial_no";

const SR_SELECT = "id, status, remarks, display_name, test_steps_id";


// ─────────────────────────────────────────────────────────────────────────────
// Internal utilities
// ─────────────────────────────────────────────────────────────────────────────

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildPendingResult(step: RawStepDef): RawStepResult {
  return {
    id:           "",
    status:       "pending",
    remarks:      "",
    display_name: "",
    step: {
      id:                  step.id,
      serial_no:           step.serial_no,
      action:              step.action,
      expected_result:     step.expected_result,
      is_divider:          step.is_divider,
      action_image_urls:   step.action_image_urls,
      expected_image_urls: step.expected_image_urls,
      tests_serial_no:     step.tests_serial_no,
    },
  };
}
  function applyStatuses(
    orderedStepIds: string[],
    stepsById:      Record<string, RawStepDef>,
    srMap:          Map<string, RawSrRow>
  ): RawStepResult[] {
    const results: (RawStepResult | null)[] = orderedStepIds.map((stepId) => {
      const step = stepsById[stepId];
      if (!step) return null;
      const sr = srMap.get(stepId);
      return {
        id:           sr?.id           ?? "",
        status:       (sr?.status      ?? "pending") as "pass" | "fail" | "pending",
        remarks:      sr?.remarks      ?? "",
        display_name: sr?.display_name ?? "",
        step: {
          id:                  step.id,
          serial_no:           step.serial_no,
          action:              step.action,
          expected_result:     step.expected_result,
          is_divider:          step.is_divider,
          action_image_urls:   step.action_image_urls,
          expected_image_urls: step.expected_image_urls,
          tests_serial_no:     step.tests_serial_no,
        },
      };
    });
  
    // ✅ TypeScript now correctly narrows: (RawStepResult | null)[] → RawStepResult[]
    return results.filter((r): r is RawStepResult => r !== null);
  }

/**
 * Fetches step definitions in batches of BATCH_SIZE.
 * Replaces single .in("id", allIds) calls that blow the URL limit at ~2k+ IDs.
 */
async function fetchStepDefsBatched(
  ids: string[]
): Promise<Record<string, RawStepDef>> {
  if (!ids.length) return {};

  const batches = chunkArray(ids, BATCH_SIZE);
  const results = await Promise.all(
    batches.map((batch) =>
      supabase.from("test_steps").select(STEP_SELECT).in("id", batch)
    )
  );

  const stepsById: Record<string, RawStepDef> = {};
  for (const { data, error } of results) {
    if (error) throw new Error(error.message);
    for (const s of (data ?? []) as any[]) {
      stepsById[s.id] = s as RawStepDef;
    }
  }
  return stepsById;
}


// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 — fetchTestExecutionShell
// Fast: everything except real step_result statuses.
// step_results is returned with status "pending" so the UI renders at once.
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchTestExecutionShell(
  module_test_id: string
): Promise<TestExecutionShell> {

  // ── 1. module_test row ───────────────────────────────────────────────────
  const { data: mtData, error: mtErr } = await supabase
    .from("module_tests")
    .select("module_name, tests_name, is_visible, test:tests!module_tests_tests_name_fkey(serial_no, name)")
    .eq("id", module_test_id)
    .single();
  if (mtErr) throw mtErr;

  const module_name:     string  = (mtData as any)?.module_name ?? "";
  const currentSerialNo: string  = (mtData as any)?.test?.serial_no ?? "";
  const is_visible:      boolean = (mtData as any)?.is_visible ?? true;

  // ── 2. All module_tests (parallel-safe, no .in() needed) ─────────────────
  const [allMtRes] = await Promise.all([
    supabase
      .from("module_tests")
      .select("id, tests_name, is_visible, test:tests!module_tests_tests_name_fkey(serial_no, name)")
      .eq("module_name", module_name)
      .order("tests_name"),
  ]);
  if (allMtRes.error) throw allMtRes.error;

  const allMts = (allMtRes.data ?? []) as unknown as RawModuleTestItem[];
  const serialNos: string[] = allMts
    .map((mt) => (mt as any).test?.serial_no as string | undefined)
    .filter((s): s is string => !!s);

  // ── 3. Active revisions ──────────────────────────────────────────────────
  const activeRevisions: Record<string, ActiveRevision> = {};
  let stepOrder: string[] | null = null;

  if (serialNos.length > 0) {
    const { data: revData, error: revErr } = await supabase
      .from("test_revisions")
      .select("id, revision, tests_serial_no, step_order")
      .eq("status", "active")
      .in("tests_serial_no", serialNos);
    if (revErr) throw revErr;

    ((revData ?? []) as any[]).forEach((r) => {
      activeRevisions[r.tests_serial_no] = {
        id:              r.id,
        revision:        r.revision,
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

  const current_revision  = activeRevisions[currentSerialNo] ?? null;
  const resolvedStepOrder = stepOrder as string[] | null;

  // ── 4. Fetch step definitions (BATCHED — safe at any step count) ──────────
  let orderedStepIds: string[] = [];
  let stepsById: Record<string, RawStepDef> = {};

  if (resolvedStepOrder !== null && resolvedStepOrder.length > 0) {
    // Revision path — IDs come from step_order; batch-fetch definitions.
    // A single .in("id", 5000ids) produces a ~180 KB URL and hard-fails;
    // batching at 500 keeps every request well under limits.
    orderedStepIds = resolvedStepOrder;
    stepsById = await fetchStepDefsBatched(orderedStepIds);

  } else if (currentSerialNo) {
    // Fallback path — ordered by serial_no. No .in() needed; always safe.
    const { data: stepsData, error: stepsErr } = await supabase
      .from("test_steps")
      .select(STEP_SELECT)
      .eq("tests_serial_no", currentSerialNo)
      .order("serial_no");
    if (stepsErr) throw stepsErr;

    orderedStepIds = ((stepsData ?? []) as any[]).map((s) => s.id as string);
    ((stepsData ?? []) as any[]).forEach((s) => { stepsById[s.id] = s as RawStepDef; });
  }

  // Build pending results so the full step list renders immediately
  const step_results: RawStepResult[] = orderedStepIds
    .map((id) => stepsById[id] ? buildPendingResult(stepsById[id]) : null)
    .filter((r): r is RawStepResult => r !== null);

  return {
    module_name,
    is_visible,
    current_revision,
    active_revisions:  activeRevisions,
    module_tests:      allMts,
    step_results,
    _orderedStepIds:   orderedStepIds,
    _stepsById:        stepsById,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — streamTestStepResults
// 500 step IDs per request, up to 100 concurrent per wave.
// onBatch() fires after each wave with a fully rebuilt RawStepResult[].
// ─────────────────────────────────────────────────────────────────────────────

export async function streamTestStepResults(
  shell:   TestExecutionShell,
  onBatch: (updatedResults: RawStepResult[]) => void,
  signal?: AbortSignal,
  token?:  StreamCancellationToken
): Promise<void> {
  if (shell._orderedStepIds.length === 0) return;

  const srMap       = new Map<string, RawSrRow>();
  const isCancelled = () => token?.cancelled || signal?.aborted;
  const batches     = chunkArray(shell._orderedStepIds, BATCH_SIZE);

  for (let i = 0; i < batches.length; i += WAVE_SIZE) {
    if (isCancelled()) return;

    const wave = batches.slice(i, i + WAVE_SIZE);

    const results = await Promise.all(
      wave.map((batch) => {
        // FIX: abortSignal(signal!) was passing undefined at runtime → TypeError.
        // Only attach the signal when it is actually defined.
        const q = supabase
          .from("step_results")
          .select(SR_SELECT)
          .eq("module_name", shell.module_name)
          .in("test_steps_id", batch);
        return signal ? q.abortSignal(signal) : q;
      })
    );

    if (isCancelled()) return;

    for (const { data, error } of results) {
      if (error) {
        if (error.message?.includes("AbortError") || signal?.aborted) return;
        throw new Error(error.message);
      }
      for (const row of (data ?? []) as RawSrRow[]) {
        srMap.set(row.test_steps_id, row);
      }
    }

    // Rebuild full ordered list — statuses fill in progressively wave by wave.
    onBatch(applyStatuses(shell._orderedStepIds, shell._stepsById, srMap));
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// fetchTestExecution  (legacy one-shot — kept for backward compat)
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchTestExecution(
  module_test_id: string
): Promise<TestExecutionData> {
  const shell = await fetchTestExecutionShell(module_test_id);
  const srMap = new Map<string, RawSrRow>();

  if (shell._orderedStepIds.length > 0) {
    // FIX: was a single .in("id", allIds) — now batched via same BATCH_SIZE.
    const batches = chunkArray(shell._orderedStepIds, BATCH_SIZE);
    const allResults = await Promise.all(
      batches.map((batch) =>
        supabase
          .from("step_results")
          .select(SR_SELECT)
          .eq("module_name", shell.module_name)
          .in("test_steps_id", batch)
      )
    );
    for (const { data, error } of allResults) {
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as RawSrRow[]) {
        srMap.set(row.test_steps_id, row);
      }
    }
  }

  return {
    module_name:      shell.module_name,
    step_results:     applyStatuses(shell._orderedStepIds, shell._stepsById, srMap),
    module_tests:     shell.module_tests,
    active_revisions: shell.active_revisions,
    current_revision: shell.current_revision,
    is_visible:       shell.is_visible,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// Lock management
// ─────────────────────────────────────────────────────────────────────────────

export async function acquireLock(
  module_test_id: string,
  user_id:        string,
  display_name:   string
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
      .update({ locked_by_name: display_name, locked_at: new Date().toISOString() })
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
    locked_at:      new Date().toISOString(),
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
  user_id:        string
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
  user_id:        string
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
  module_name:   string;
  status:        "pass" | "fail" | "pending";
  remarks:       string;
  display_name:  string;
}): Promise<void> {
  const { error } = await supabase
    .from("step_results")
    .update({
      status:       payload.status,
      remarks:      payload.remarks,
      display_name: payload.display_name,
    })
    .eq("test_steps_id", payload.test_steps_id)
    .eq("module_name",   payload.module_name);
  if (error) throw error;
}

/**
 * Resets all step results for a specific test within a module.
 * Accepts the step_result row IDs directly (already scoped by the caller).
 * Empty-string IDs (steps not yet persisted) are filtered out before the query.
 */
export async function resetAllStepResults(
  module_name:   string,
  stepResultIds: string[],
  display_name:  string
): Promise<void> {
  // Filter out empty IDs — Phase 1 pending rows have id: "" and would cause
  // .in("id", ["",...]) to match nothing or error.
  const validIds = stepResultIds.filter(Boolean);
  if (!validIds.length) return;

  const batches = chunkArray(validIds, BATCH_SIZE);
  const results = await Promise.all(
    batches.map((batch) =>
      supabase
        .from("step_results")
        .update({ status: "pending", remarks: "", display_name })
        .in("id", batch)
    )
  );
  for (const { error } of results) {
    if (error) throw error;
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Signed image URLs
// FIX: was calling createSignedUrl (singular) in a Promise.all loop —
// 5k steps with images = up to 5k HTTP requests.
// Now uses createSignedUrls (batch API), 500 paths per request.
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchSignedUrls(
  paths: string[]
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (!unique.length) return {};

  const batches = chunkArray(unique, 500);
  const allEntries: [string, string][] = [];

  for (const batch of batches) {
    const { data, error } = await supabase.storage
      .from("test_steps")
      .createSignedUrls(batch, 3600);

    if (error || !data) continue;

    for (const entry of data) {
      if (entry.signedUrl) allEntries.push([entry.path!, entry.signedUrl!]);
    }
  }

  return Object.fromEntries(allEntries);
}