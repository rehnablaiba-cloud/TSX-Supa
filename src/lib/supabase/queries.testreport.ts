/**
 * queries.testreport.ts
 *
 * Two-phase loading strategy (mirrors queries.moduledashboard.ts):
 *
 *  Phase 1 — fetchTestReportShell(module_test_id)
 *    Fetches module_test meta + active revision + step definitions.
 *    Returns shell with results pre-populated as "pending" so the full
 *    step list renders immediately without waiting for the DB.
 *
 *  Phase 2 — streamTestReportResults(shell, onBatch, signal?, token?)
 *    Step IDs split into chunks of 500, up to 100 concurrent per wave.
 *    onBatch() fires after each wave so statuses fill in progressively.
 *    Accepts a cancellation token so superseded fetches abort cleanly.
 */
import { supabase } from "../../supabase";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface ReportRevision {
  id:       string;
  revision: string;
}

export interface ReportMeta {
  module_name:     string;
  tests_name:      string;
  is_visible:      boolean;
  test:            { serial_no: string; name: string; description?: string } | null;
  active_revision: ReportRevision | null;
}

export interface ReportStepResult {
  id:           string;
  status:       "pass" | "fail" | "pending";
  remarks:      string;
  display_name: string;
  step: {
    id:              string;
    serial_no:       number;
    action:          string;
    expected_result: string;
    is_divider:      boolean;
    tests_serial_no: string;
  } | null;
}

export interface TestReportData {
  meta:    ReportMeta;
  results: ReportStepResult[];
}

/** Result of Phase 1. Pass to streamTestReportResults(). */
export interface TestReportShell {
  meta:    ReportMeta;
  /** Full step list with status "pending" — renders immediately. */
  results: ReportStepResult[];

  /** @internal */
  _orderedStepIds: string[];
  /** @internal */
  _stepsById:      Record<string, RawStepDef>;
}

export interface StreamCancellationToken {
  cancelled: boolean;
}

// ── Types kept for backward compat ──────────────────────────────────────────
export interface ModuleOption        { name: string; }
export interface SessionStepEntry    {
  id: string; test_steps_id: string; module_name: string;
  status: string; remarks: string; updated_at: string;
  action: string; expected_result: string; serial_no: number;
  is_divider: boolean; tests_serial_no: string;
}
export interface SessionTestGroup    {
  module_name: string; tests_serial_no: string;
  steps: SessionStepEntry[];
  pass: number; fail: number; undo: number; total: number;
}
export interface ModuleRow {
  name: string; description: string;
  module_tests: {
    id: string; tests_name: string; is_visible: boolean;
    test: { serial_no: string; name: string } | null;
    active_revision: ReportRevision | null;
  }[];
  step_results: ReportStepResult[];
}
export type ModuleTestMeta = ReportMeta;
export type StepResultRow  = ReportStepResult;

// ─────────────────────────────────────────────────────────────────────────────
// Internal types & constants
// ─────────────────────────────────────────────────────────────────────────────

interface RawStepDef {
  id:              string;
  serial_no:       number;
  action:          string;
  expected_result: string;
  is_divider:      boolean;
  tests_serial_no: string;
}

const BATCH_SIZE = 500;
const WAVE_SIZE  = 100;

const STEP_SELECT = "id, serial_no, action, expected_result, is_divider, tests_serial_no";
const SR_SELECT   = `
  id, status, remarks, display_name, test_steps_id,
  step:test_steps!step_results_test_steps_id_fkey(
    id, serial_no, action, expected_result, is_divider, tests_serial_no
  )
`;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildPendingResult(step: RawStepDef): ReportStepResult {
  return {
    id: "", status: "pending", remarks: "", display_name: "",
    step: {
      id:              step.id,
      serial_no:       step.serial_no,
      action:          step.action,
      expected_result: step.expected_result,
      is_divider:      step.is_divider,
      tests_serial_no: step.tests_serial_no,
    },
  };
}

function applyStatuses(
  orderedStepIds: string[],
  stepsById:      Record<string, RawStepDef>,
  srMap:          Map<string, { id: string; status: "pass" | "fail" | "pending"; remarks: string; display_name: string }>
): ReportStepResult[] {
  const results: (ReportStepResult | null)[] = orderedStepIds.map((stepId) => {
    const step = stepsById[stepId];
    if (!step) return null;
    const sr = srMap.get(stepId);
    return {
      id:           sr?.id           ?? "",
      status:       sr?.status       ?? "pending",
      remarks:      sr?.remarks      ?? "",
      display_name: sr?.display_name ?? "",
      step: {
        id:              step.id,
        serial_no:       step.serial_no,
        action:          step.action,
        expected_result: step.expected_result,
        is_divider:      step.is_divider,
        tests_serial_no: step.tests_serial_no,
      },
    };
  });
  return results.filter((r): r is ReportStepResult => r !== null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 — fetchTestReportShell
// Fast: meta + revision + step defs. All statuses are "pending".
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchTestReportShell(
  module_test_id: string
): Promise<TestReportShell> {

  // ── 1. module_test meta ──────────────────────────────────────────────────
  const { data: mtData, error: mtErr } = await supabase
    .from("module_tests")
    .select("module_name, tests_name, is_visible, test:tests!module_tests_tests_name_fkey(serial_no, name, description)")
    .eq("id", module_test_id)
    .single();
  if (mtErr) throw new Error(mtErr.message);

  const raw            = mtData as any;
  const module_name    = raw.module_name    as string;
  const tests_name     = raw.tests_name     as string;
  const is_visible     = (raw.is_visible    ?? true) as boolean;
  const test           = raw.test           ?? null;
  const tests_serial_no = test?.serial_no   ?? "";

  // ── 2. Active revision + step_order ─────────────────────────────────────
  let orderedStepIds: string[] = [];
  let active_revision: ReportRevision | null = null;

  if (tests_serial_no) {
    const { data: revData, error: revErr } = await supabase
      .from("test_revisions")
      .select("id, revision, step_order")
      .eq("tests_serial_no", tests_serial_no)
      .eq("status", "active")
      .maybeSingle();
    if (revErr) throw new Error(revErr.message);

    if (revData) {
      active_revision  = { id: (revData as any).id, revision: (revData as any).revision };
      orderedStepIds   = Array.isArray((revData as any).step_order)
        ? ((revData as any).step_order as string[])
        : [];
    }
  }

  // ── 3. Step definitions (batched) ────────────────────────────────────────
  const stepsById: Record<string, RawStepDef> = {};

  if (orderedStepIds.length > 0) {
    // Revision path — fetch by ID batches
    const batches = chunkArray(orderedStepIds, BATCH_SIZE);
    const results = await Promise.all(
      batches.map((batch) =>
        supabase.from("test_steps").select(STEP_SELECT).in("id", batch)
      )
    );
    for (const { data, error } of results) {
      if (error) throw new Error(error.message);
      for (const s of (data ?? []) as any[]) stepsById[s.id] = s as RawStepDef;
    }
  } else if (tests_serial_no) {
    // Fallback — no revision, fetch by serial_no order
    const { data: stepsData, error: stepsErr } = await supabase
      .from("test_steps")
      .select(STEP_SELECT)
      .eq("tests_serial_no", tests_serial_no)
      .order("serial_no");
    if (stepsErr) throw new Error(stepsErr.message);

    orderedStepIds = ((stepsData ?? []) as any[]).map((s) => s.id as string);
    ((stepsData ?? []) as any[]).forEach((s) => { stepsById[s.id] = s as RawStepDef; });
  }

  const meta: ReportMeta = { module_name, tests_name, is_visible, test, active_revision };

  const results = orderedStepIds
    .map((id) => stepsById[id] ? buildPendingResult(stepsById[id]) : null)
    .filter((r): r is ReportStepResult => r !== null);

  return { meta, results, _orderedStepIds: orderedStepIds, _stepsById: stepsById };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — streamTestReportResults
// Waves of 500 step IDs × 100 concurrent. onBatch() fires per wave.
// ─────────────────────────────────────────────────────────────────────────────

export async function streamTestReportResults(
  shell:   TestReportShell,
  onBatch: (updatedResults: ReportStepResult[]) => void,
  signal?: AbortSignal,
  token?:  StreamCancellationToken
): Promise<void> {
  if (shell._orderedStepIds.length === 0) return;

  const srMap       = new Map<string, { id: string; status: "pass" | "fail" | "pending"; remarks: string; display_name: string }>();
  const isCancelled = () => token?.cancelled || signal?.aborted;
  const batches     = chunkArray(shell._orderedStepIds, BATCH_SIZE);

  for (let i = 0; i < batches.length; i += WAVE_SIZE) {
    if (isCancelled()) return;

    const wave = batches.slice(i, i + WAVE_SIZE);
    const results = await Promise.all(
      wave.map((batch) => {
        const q = supabase
          .from("step_results")
          .select("id, status, remarks, display_name, test_steps_id")
          .eq("module_name", shell.meta.module_name)
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
      for (const row of (data ?? []) as any[]) {
        srMap.set(row.test_steps_id, row);
      }
    }

    onBatch(applyStatuses(shell._orderedStepIds, shell._stepsById, srMap));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchTestReportData — legacy one-shot (backward compat)
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchTestReportData(
  module_test_id: string
): Promise<TestReportData> {
  const shell = await fetchTestReportShell(module_test_id);
  const srMap = new Map<string, { id: string; status: "pass" | "fail" | "pending"; remarks: string; display_name: string }>();

  if (shell._orderedStepIds.length > 0) {
    const batches = chunkArray(shell._orderedStepIds, BATCH_SIZE);
    const allResults = await Promise.all(
      batches.map((batch) =>
        supabase
          .from("step_results")
          .select("id, status, remarks, display_name, test_steps_id")
          .eq("module_name", shell.meta.module_name)
          .in("test_steps_id", batch)
      )
    );
    for (const { data, error } of allResults) {
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as any[]) srMap.set(row.test_steps_id, row);
    }
  }

  return {
    meta:    shell.meta,
    results: applyStatuses(shell._orderedStepIds, shell._stepsById, srMap),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Standalone queries — unchanged
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchModuleOptions(): Promise<ModuleOption[]> {
  const { data } = await supabase.from("modules").select("name").order("name");
  return (data ?? []) as ModuleOption[];
}

export async function fetchReportStepResults(
  module_name: string
): Promise<ReportStepResult[]> {
  const { data, error } = await supabase
    .from("step_results")
    .select(SR_SELECT)
    .eq("module_name", module_name)
    .order("id");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ReportStepResult[];
}

export async function fetchModuleReports(
  selectedModuleName: string | null
): Promise<ModuleRow[]> {
  let query = supabase
    .from("modules")
    .select(`
      name, description,
      module_tests:module_tests!module_name(
        id, tests_name, is_visible,
        test:tests!tests_name(serial_no, name)
      ),
      step_results:step_results!module_name(
        id, status, remarks, display_name,
        step:test_steps!step_results_test_steps_id_fkey(
          id, serial_no, action, expected_result, is_divider, tests_serial_no
        )
      )
    `)
    .order("name", { ascending: true });

  if (selectedModuleName) query = (query as any).eq("name", selectedModuleName);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as any[];
  const allSerialNos: string[] = Array.from(new Set(
    rows.flatMap((mod) =>
      ((mod.module_tests ?? []) as any[])
        .map((mt: any) => mt.test?.serial_no as string | undefined)
        .filter((s): s is string => !!s)
    )
  ));

  const revisionsBySerialNo: Record<string, ReportRevision & { step_order: string[] }> = {};
  if (allSerialNos.length > 0) {
    const { data: revData, error: revErr } = await supabase
      .from("test_revisions")
      .select("id, revision, tests_serial_no, step_order")
      .eq("status", "active")
      .in("tests_serial_no", allSerialNos);
    if (revErr) throw new Error(revErr.message);
    ((revData ?? []) as any[]).forEach((r) => {
      revisionsBySerialNo[r.tests_serial_no] = {
        id: r.id, revision: r.revision,
        step_order: Array.isArray(r.step_order) ? r.step_order : [],
      };
    });
  }

  const inScopeStepIds = new Set<string>(
    Object.values(revisionsBySerialNo).flatMap((r) => r.step_order)
  );

  return rows.map((mod) => {
    const enrichedMts = ((mod.module_tests ?? []) as any[]).map((mt) => ({
      ...mt,
      is_visible:      mt.is_visible ?? true,
      active_revision: revisionsBySerialNo[mt.test?.serial_no ?? ""]
        ? { id: revisionsBySerialNo[mt.test.serial_no].id, revision: revisionsBySerialNo[mt.test.serial_no].revision }
        : null,
    }));

    const revisedSerialNos = new Set(Object.keys(revisionsBySerialNo));
    const filteredResults  = ((mod.step_results ?? []) as any[]).filter((sr) => {
      const sn = sr.step?.tests_serial_no;
      if (!sn) return false;
      return revisedSerialNos.has(sn) ? inScopeStepIds.has(sr.step?.id) : true;
    });

    return { ...mod, module_tests: enrichedMts, step_results: filteredResults };
  }) as ModuleRow[];
}

export async function fetchSessionSteps(
  username:     string,
  sessionStart: string
): Promise<SessionStepEntry[]> {
  const { data, error } = await supabase
    .from("step_results")
    .select(`id, test_steps_id, module_name, status, remarks, updated_at,
      test_steps:test_steps_id(action, expected_result, serial_no, is_divider, tests_serial_no)`)
    .eq("display_name", username)
    .gte("updated_at", sessionStart)
    .order("updated_at", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((r: any) => ({
    id: r.id, test_steps_id: r.test_steps_id, module_name: r.module_name,
    status: r.status, remarks: r.remarks ?? "", updated_at: r.updated_at,
    action: r.test_steps?.action ?? "", expected_result: r.test_steps?.expected_result ?? "",
    serial_no: r.test_steps?.serial_no ?? 0, is_divider: r.test_steps?.is_divider ?? false,
    tests_serial_no: r.test_steps?.tests_serial_no ?? "",
  }));
}