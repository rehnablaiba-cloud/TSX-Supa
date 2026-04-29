/**
 * queries.testreport.ts
 */
import { supabase } from "../../supabase";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ReportMeta {
  module_name: string;
  tests_name: string;
  test: { serial_no: string; name: string; description?: string } | null;
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
    tests_serial_no: string; // ← was tests_name
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
    test: { serial_no: string; name: string } | null;
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
  // joined from test_steps
  action: string;
  expected_result: string;
  serial_no: number;
  is_divider: boolean;
  tests_serial_no: string; // ← was tests_name
}

export interface SessionTestGroup {
  module_name: string;
  tests_name: string;
  steps: SessionStepEntry[];
  pass: number;
  fail: number;
  undo: number;
  total: number;
}

// Aliases
export type ModuleTestMeta = ReportMeta;
export type StepResultRow = ReportStepResult;

// ─────────────────────────────────────────────────────────────────────────────
// Drill-down queries
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchTestReportData(
  module_test_id: string
): Promise<TestReportData> {
  const { data: metaData, error: metaErr } = await supabase
    .from("module_tests")
    .select(
      "module_name, tests_name, test:tests!module_tests_tests_name_fkey(serial_no, name, description)"
    )
    .eq("id", module_test_id)
    .single();

  if (metaErr) throw new Error(metaErr.message);
  const meta = metaData as unknown as ReportMeta;

  const { data: srData, error: srErr } = await supabase
    .from("step_results")
    .select(
      `
      id, status, remarks, display_name,
      step:test_steps!step_results_test_steps_id_fkey(
        id, serial_no, action, expected_result, is_divider, tests_serial_no
      )
    ` // ← tests_name → tests_serial_no
    )
    .eq("module_name", meta.module_name)
    .order("id");

  if (srErr) throw new Error(srErr.message);

  return {
    meta,
    results: (srData ?? []) as unknown as ReportStepResult[],
  };
}

export async function fetchReportStepResults(
  module_name: string
): Promise<ReportStepResult[]> {
  const { data, error } = await supabase
    .from("step_results")
    .select(
      `
      id, status, remarks, display_name,
      step:test_steps!step_results_test_steps_id_fkey(
        id, serial_no, action, expected_result, is_divider, tests_serial_no
      )
    ` // ← tests_name → tests_serial_no
    )
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
  let query = supabase
    .from("modules")
    .select(
      `
      name, description,
      module_tests:module_tests!module_name(
        id, tests_name,
        test:tests!tests_name(serial_no, name)
      ),
      step_results:step_results!module_name(
        id, status, remarks, display_name,
        step:test_steps!step_results_test_steps_id_fkey(
          id, serial_no, action, expected_result, is_divider, tests_serial_no
        )
      )
    ` // ← tests_name → tests_serial_no in step join
    )
    .order("name", { ascending: true });

  if (selectedModuleName) query = (query as any).eq("name", selectedModuleName);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ModuleRow[];
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
       )` // ← tests_name → tests_serial_no
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
    tests_serial_no: r.test_steps?.tests_serial_no ?? "", // ← was tests_name
  }));
}
