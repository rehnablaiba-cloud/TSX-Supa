/**
 * queries.testreport.ts
 *
 * Revision-aware update (2025):
 *  - Aligned with testexecution + dashboard: step_order array is the sole
 *    source of truth for which steps to show (not revision_id on step_results).
 *  - is_visible now lives on module_tests (not test_revisions).
 */
import { supabase } from "../../supabase";


// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────


export interface ReportMeta {
  module_name: string;
  tests_name: string;
  is_visible: boolean;
  test: { serial_no: string; name: string; description?: string } | null;
  active_revision: ReportRevision | null;
}


export interface ReportRevision {
  id: string;
  revision: string;
  // ✅ is_visible removed — lives on module_tests
}


export interface ReportStepResult {
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
    tests_serial_no: string;
  } | null;
}


export interface TestReportData {
  meta: ReportMeta;
  results: ReportStepResult[];
}


export interface ModuleOption {
  name: string;
}


export interface ModuleRow {
  name: string;
  description: string;
  module_tests: {
    id: string;
    tests_name: string;
    is_visible: boolean;
    test: { serial_no: string; name: string } | null;
    active_revision: ReportRevision | null;
  }[];
  step_results: ReportStepResult[];
}


export interface SessionStepEntry {
  id: string;
  test_steps_id: string;
  module_name: string;
  status: string;
  remarks: string;
  updated_at: string;
  action: string;
  expected_result: string;
  serial_no: number;
  is_divider: boolean;
  tests_serial_no: string;
}


export interface SessionTestGroup {
  module_name: string;
  tests_serial_no: string;
  steps: SessionStepEntry[];
  pass: number;
  fail: number;
  undo: number;
  total: number;
}


export type ModuleTestMeta = ReportMeta;
export type StepResultRow = ReportStepResult;


// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────


const SR_SELECT = `
  id, status, remarks, display_name,
  step:test_steps!step_results_test_steps_id_fkey(
    id, serial_no, action, expected_result, is_divider, tests_serial_no
  )
`;


/**
 * ✅ FIXED: mirrors testexecution + dashboard pattern.
 * Uses step_order from active revision as the authoritative filter.
 * Falls back to all steps ordered by serial_no when no revision exists.
 */
async function fetchScopedResults(
  module_name: string,
  tests_serial_no: string,
  revision: (ReportRevision & { step_order: string[] }) | null
): Promise<ReportStepResult[]> {

  // ── Revision path: fetch only step IDs in step_order ──────────────────────
  if (revision && revision.step_order.length > 0) {
    const { data, error } = await supabase
      .from("step_results")
      .select(SR_SELECT)
      .eq("module_name", module_name)
      .in("test_steps_id", revision.step_order);

    if (error) throw new Error(error.message);

    // ✅ Preserve step_order sequence (same as testexecution)
    const byId = new Map(
      ((data ?? []) as any[]).map((r) => [r.step?.id ?? "", r])
    );
    return revision.step_order
      .map((sid) => byId.get(sid))
      .filter((r): r is ReportStepResult => !!r);
  }

  // ── Fallback path: all steps for this test ordered by serial_no ───────────
  const { data: stepsData, error: stepsErr } = await supabase
    .from("test_steps")
    .select("id")
    .eq("tests_serial_no", tests_serial_no)
    .order("serial_no");

  if (stepsErr) throw new Error(stepsErr.message);

  const stepIds = ((stepsData ?? []) as any[]).map((s) => s.id as string);
  if (!stepIds.length) return [];

  const { data, error } = await supabase
    .from("step_results")
    .select(SR_SELECT)
    .eq("module_name", module_name)
    .in("test_steps_id", stepIds);

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ReportStepResult[];
}


// ─────────────────────────────────────────────────────────────────────────────
// Drill-down queries
// ─────────────────────────────────────────────────────────────────────────────


export async function fetchTestReportData(
  module_test_id: string
): Promise<TestReportData> {
  // 1. Fetch module_test meta (includes is_visible)
  const { data: metaData, error: metaErr } = await supabase
    .from("module_tests")
    .select(
      "module_name, tests_name, is_visible, test:tests!module_tests_tests_name_fkey(serial_no, name, description)"
    )
    .eq("id", module_test_id)
    .single();

  if (metaErr) throw new Error(metaErr.message);

  const rawMeta = metaData as any;
  const tests_serial_no: string = rawMeta?.test?.serial_no ?? "";

  // 2. Fetch active revision WITH step_order (key fix)
  const { data: revData, error: revErr } = await supabase
    .from("test_revisions")
    .select("id, revision, step_order") // ✅ step_order fetched here
    .eq("tests_serial_no", tests_serial_no)
    .eq("status", "active")
    .maybeSingle();

  if (revErr) throw new Error(revErr.message);

  const active_revision = revData
    ? {
        id: (revData as any).id,
        revision: (revData as any).revision,
        step_order: Array.isArray((revData as any).step_order)
          ? ((revData as any).step_order as string[])
          : [],
      }
    : null;

  const meta: ReportMeta = {
    module_name: rawMeta.module_name,
    tests_name: rawMeta.tests_name,
    is_visible: rawMeta.is_visible ?? true,
    test: rawMeta.test ?? null,
    // strip step_order before returning to caller
    active_revision: active_revision
      ? { id: active_revision.id, revision: active_revision.revision }
      : null,
  };

  // 3. Fetch results scoped by step_order (✅ fixed)
  const results = await fetchScopedResults(
    rawMeta.module_name,
    tests_serial_no,
    active_revision
  );

  return { meta, results };
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


// ─────────────────────────────────────────────────────────────────────────────
// Standalone queries
// ─────────────────────────────────────────────────────────────────────────────


export async function fetchModuleOptions(): Promise<ModuleOption[]> {
  const { data } = await supabase.from("modules").select("name").order("name");
  return (data ?? []) as ModuleOption[];
}


export async function fetchModuleReports(
  selectedModuleName: string | null
): Promise<ModuleRow[]> {
  // 1. Fetch modules + module_tests (with is_visible) + step_results
  let query = supabase
    .from("modules")
    .select(
      `
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
    `
    )
    .order("name", { ascending: true });

  if (selectedModuleName) query = (query as any).eq("name", selectedModuleName);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as any[];

  // 2. Collect all serial_nos
  const allSerialNos: string[] = Array.from(
    new Set(
      rows.flatMap((mod) =>
        ((mod.module_tests ?? []) as any[])
          .map((mt: any) => mt.test?.serial_no as string | undefined)
          .filter((s): s is string => !!s)
      )
    )
  );

  // 3. Batch-fetch active revisions WITH step_order (✅ key fix)
  const revisionsBySerialNo: Record<
    string,
    ReportRevision & { step_order: string[] }
  > = {};

  if (allSerialNos.length > 0) {
    const { data: revData, error: revErr } = await supabase
      .from("test_revisions")
      .select("id, revision, tests_serial_no, step_order") // ✅ step_order added
      .eq("status", "active")
      .in("tests_serial_no", allSerialNos);

    if (revErr) throw new Error(revErr.message);

    ((revData ?? []) as any[]).forEach((r) => {
      revisionsBySerialNo[r.tests_serial_no] = {
        id: r.id,
        revision: r.revision,
        step_order: Array.isArray(r.step_order) ? r.step_order : [],
      };
    });
  }

  // 4. Build set of all in-scope step IDs across all revisions
  const inScopeStepIds = new Set<string>(
    Object.values(revisionsBySerialNo).flatMap((r) => r.step_order)
  );

  // 5. Enrich each module + filter step_results to revision scope
  return rows.map((mod) => {
    const enrichedMts = ((mod.module_tests ?? []) as any[]).map((mt) => ({
      ...mt,
      is_visible: mt.is_visible ?? true,
      active_revision: revisionsBySerialNo[mt.test?.serial_no ?? ""]
        ? {
            id: revisionsBySerialNo[mt.test.serial_no].id,
            revision: revisionsBySerialNo[mt.test.serial_no].revision,
          }
        : null,
    }));

    // ✅ Filter step_results: keep only steps in step_order for revised tests,
    //    keep all steps for legacy tests (no revision)
    const revisedSerialNos = new Set(Object.keys(revisionsBySerialNo));
    const filteredResults = ((mod.step_results ?? []) as any[]).filter((sr) => {
      const testsSerialNo = sr.step?.tests_serial_no;
      if (!testsSerialNo) return false;
      if (revisedSerialNos.has(testsSerialNo)) {
        return inScopeStepIds.has(sr.step?.id);
      }
      return true; // legacy: no revision, keep all
    });

    return {
      ...mod,
      module_tests: enrichedMts,
      step_results: filteredResults,
    };
  }) as ModuleRow[];
}


// ─────────────────────────────────────────────────────────────────────────────
// Session queries
// ─────────────────────────────────────────────────────────────────────────────


export async function fetchSessionSteps(
  username: string,
  sessionStart: string
): Promise<SessionStepEntry[]> {
  const { data, error } = await supabase
    .from("step_results")
    .select(
      `id, test_steps_id, module_name, status, remarks, updated_at,
       test_steps:test_steps_id (
         action, expected_result, serial_no, is_divider, tests_serial_no
       )`
    )
    .eq("display_name", username)
    .gte("updated_at", sessionStart)
    .order("updated_at", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((r: any) => ({
    id: r.id,
    test_steps_id: r.test_steps_id,
    module_name: r.module_name,
    status: r.status,
    remarks: r.remarks ?? "",
    updated_at: r.updated_at,
    action: r.test_steps?.action ?? "",
    expected_result: r.test_steps?.expected_result ?? "",
    serial_no: r.test_steps?.serial_no ?? 0,
    is_divider: r.test_steps?.is_divider ?? false,
    tests_serial_no: r.test_steps?.tests_serial_no ?? "",
  }));
}