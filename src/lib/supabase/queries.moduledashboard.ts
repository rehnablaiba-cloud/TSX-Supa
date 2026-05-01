/**
 * queries.moduledashboard.ts
 *
 * Two-phase loading strategy (mirrors queries.dashboard.ts):
 *
 *  Phase 1 — fetchModuleDashboardShell(module_name, signal?)
 *    Fetches module_tests + revisions + locks (~fast).
 *    Returns shell with step_results: [] on every ModuleTestRow.
 *    ModuleDashboard renders cards immediately from this.
 *
 *  Phase 2 — streamModuleStepResults(module_name, shell, onBatch, signal?, token?)
 *    Step IDs are split into chunks of 500.
 *    Up to 100 chunks fire in parallel; onBatch() is called once per wave
 *    so bars/counts animate upward as each wave resolves.
 *    Legacy tests (no active revision) are fetched in one trailing request.
 *    Accepts a cancellation token so superseded fetches abort cleanly.
 */
import { supabase } from "../../supabase";
import type {
  LockRow,
  TrimmedStepResult,
  ModuleTestRow,
  ActiveRevision,
} from "../../components/ModuleDashboard/ModuleDashboard.types";


// ─────────────────────────────────────────────────────────────────────────────
// Cancellation token
// ─────────────────────────────────────────────────────────────────────────────

/** Lightweight cancellation token — set cancelled = true to abort streaming. */
export interface StreamCancellationToken {
  cancelled: boolean;
}


// ─────────────────────────────────────────────────────────────────────────────
// Shell type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of Phase 1. Pass the whole object to streamModuleStepResults().
 * _internal fields are opaque — do not read them outside this module.
 */
export interface ModuleDashboardShell {
  /** Ready-to-render test cards. step_results is [] until Phase 2 fills it. */
  module_tests: ModuleTestRow[];
  locks:        Record<string, LockRow>;
  /** Keyed by tests_serial_no — used by ModuleDashboard to resolve per-card activeRev. */
  revisions:    Record<string, ActiveRevision>;

  /** @internal */ _revBySerial:                Record<string, ActiveRevision>;
  /** @internal */ _allStepIds:                  string[];
  /** @internal */ _serialNosWithoutRevision:    Set<string>;
}


// ─────────────────────────────────────────────────────────────────────────────
// Internal utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Step IDs per Supabase request. */
const BATCH_SIZE = 1000;
/** Max concurrent requests per wave. onBatch() fires once per wave. */
const WAVE_SIZE  = 500;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function unwrapOne<T>(val: T | T[] | null | undefined): T | null {
  if (val == null) return null;
  if (Array.isArray(val)) return val[0] ?? null;
  return val;
}

/**
 * Merge an incoming batch of raw step_result rows into the running accumulator
 * (keyed by step_result id), then rebuild ModuleTestRow[] from scratch.
 */
function applyBatch(
  accumulated: Map<string, TrimmedStepResult>,
  rawRows:     any[]
): void {
  for (const row of rawRows) {
    const step = unwrapOne(row.step) as TrimmedStepResult["step"];
    if (!step) continue; // skip orphaned results
    accumulated.set(row.id as string, {
      id:     row.id,
      status: row.status as TrimmedStepResult["status"],
      step,
    });
  }
}

function rebuildModuleTests(
  shell:       ModuleDashboardShell,
  accumulated: Map<string, TrimmedStepResult>
): ModuleTestRow[] {
  // Group accumulated step_results by tests_serial_no
  const srBySerial: Record<string, TrimmedStepResult[]> = {};
  for (const sr of accumulated.values()) {
    const key = sr.step?.tests_serial_no;
    if (!key) continue;
    (srBySerial[key] ??= []).push(sr);
  }

  return shell.module_tests.map((mt) => ({
    ...mt,
    step_results: srBySerial[mt.test?.serial_no ?? ""] ?? [],
  }));
}


// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 — fetchModuleDashboardShell
// Fast: module_tests + revisions + locks. No step_results fetched here.
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchModuleDashboardShell(
  module_name: string,
  signal?:     AbortSignal
): Promise<ModuleDashboardShell> {

  // ── 1. module_tests ─────────────────────────────────────────────────────
  const { data: mtData, error: mtErr } = await supabase
    .from("module_tests")
    .select("id, tests_name, is_visible, test:tests!module_tests_tests_name_fkey(serial_no, name)")
    .eq("module_name", module_name)
    .abortSignal(signal!);

  if (mtErr) throw new Error(mtErr.message);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const normalizedMts = (mtData ?? []).map((mt: any) => ({
    id:           mt.id as string,
    tests_name:   mt.tests_name as string,
    is_visible:   (mt.is_visible ?? true) as boolean,
    test:         unwrapOne(mt.test) as { serial_no: string; name: string } | null,
    step_results: [] as TrimmedStepResult[],
  }));

  // ── 2. Sort ──────────────────────────────────────────────────────────────
  normalizedMts.sort((a, b) => {
    const aS = a.test?.serial_no ?? "";
    const bS = b.test?.serial_no ?? "";
    return aS.localeCompare(bS, undefined, { numeric: true, sensitivity: "base" });
  });

  // ── 3. Active revisions ──────────────────────────────────────────────────
  const serialNos = normalizedMts
    .map((mt) => mt.test?.serial_no)
    .filter((s): s is string => !!s);

  const revBySerial: Record<string, ActiveRevision> = {};

  if (serialNos.length > 0) {
    const { data: revData, error: revErr } = await supabase
      .from("test_revisions")
      .select("id, revision, tests_serial_no, step_order")
      .eq("status", "active")
      .in("tests_serial_no", serialNos);

    if (revErr) throw new Error(revErr.message);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    ((revData ?? []) as any[]).forEach((r) => {
      revBySerial[r.tests_serial_no] = {
        id:         r.id,
        revision:   r.revision,
        step_order: Array.isArray(r.step_order) ? (r.step_order as string[]) : [],
      };
    });
  }

  const serialNosWithoutRevision = new Set(serialNos.filter((sn) => !revBySerial[sn]));
  const allStepIds = Array.from(
    new Set(Object.values(revBySerial).flatMap((rev) => rev.step_order))
  );

  // ── 4. Locks ─────────────────────────────────────────────────────────────
  const moduleTestIds = normalizedMts.map((mt) => mt.id);
  const lockMap: Record<string, LockRow> = {};

  if (moduleTestIds.length > 0) {
    const { data: lockData, error: lockErr } = await supabase
      .from("test_locks")
      .select("module_test_id, user_id, locked_by_name, locked_at")
      .in("module_test_id", moduleTestIds)
      .abortSignal(signal!);

    if (!lockErr && lockData) {
      (lockData as LockRow[]).forEach((l) => { lockMap[l.module_test_id] = l; });
    }
  }

  return {
    module_tests:              normalizedMts as ModuleTestRow[],
    locks:                     lockMap,
    revisions:                 revBySerial,
    _revBySerial:              revBySerial,
    _allStepIds:               allStepIds,
    _serialNosWithoutRevision: serialNosWithoutRevision,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — streamModuleStepResults
// Sequential batches of 100 (revision-scoped), then one trailing legacy fetch.
// onBatch() fires after each so the UI counts up live.
// ─────────────────────────────────────────────────────────────────────────────

const STEP_RESULT_SELECT =
  "id, status, test_steps_id, step:test_steps!step_results_test_steps_id_fkey(id, is_divider, tests_serial_no, serial_no, action, expected_result)";

export async function streamModuleStepResults(
  module_name: string,
  shell:       ModuleDashboardShell,
  onBatch:     (updatedTests: ModuleTestRow[]) => void,
  signal?:     AbortSignal,
  token?:      StreamCancellationToken
): Promise<void> {
  const accumulated = new Map<string, TrimmedStepResult>();
  const isCancelled = () => token?.cancelled || signal?.aborted;

  // ── Phase A: revision-scoped — parallel waves (500 per req, 100 concurrent) ─
  if (shell._allStepIds.length > 0) {
    const batches = chunkArray(shell._allStepIds, BATCH_SIZE);

    // Fire up to WAVE_SIZE requests concurrently; emit one UI update per wave.
    for (let i = 0; i < batches.length; i += WAVE_SIZE) {
      if (isCancelled()) return;

      const wave = batches.slice(i, i + WAVE_SIZE);

      const results = await Promise.all(
        wave.map((batch) =>
          supabase
            .from("step_results")
            .select(STEP_RESULT_SELECT)
            .in("test_steps_id", batch)
            .eq("module_name", module_name)
            .abortSignal(signal!)
        )
      );

      if (isCancelled()) return;

      for (const { data, error } of results) {
        if (error) {
          if (error.message?.includes("AbortError") || signal?.aborted) return;
          throw new Error(error.message);
        }
        applyBatch(accumulated, data ?? []);
      }

      // One render per wave — bars animate as each wave lands.
      onBatch(rebuildModuleTests(shell, accumulated));
    }
  }

  // ── Phase B: legacy tests (no active revision) ───────────────────────────
  if (shell._serialNosWithoutRevision.size > 0 && !isCancelled()) {
    // Fetch all step_results for the module; filter client-side to legacy serial_nos.
    // (PostgREST doesn't support filtering on nested relation columns reliably.)
    const { data, error } = await supabase
      .from("step_results")
      .select(STEP_RESULT_SELECT)
      .eq("module_name", module_name)
      .abortSignal(signal!);

    if (error) {
      if (error.message?.includes("AbortError") || signal?.aborted) return;
      throw new Error(error.message);
    }
    if (isCancelled()) return;

    const legacyRows = (data ?? []).filter((row: any) => {
      const step = unwrapOne(row.step) as { tests_serial_no?: string } | null;
      return step && shell._serialNosWithoutRevision.has(step.tests_serial_no ?? "");
    });

    applyBatch(accumulated, legacyRows);
    onBatch(rebuildModuleTests(shell, accumulated));
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// fetchModuleLocks  (used by Realtime lock refresh — lightweight)
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
  ((data ?? []) as LockRow[]).forEach((l) => { map[l.module_test_id] = l; });
  return map;
}