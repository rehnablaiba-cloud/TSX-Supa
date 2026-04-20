/**
 * queries.testreport.ts
 * All Supabase queries for TestReport (drill-down + standalone module report)
 */
import { supabase } from "../../supabase";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ReportMeta {
  module_name: string;
  tests_name: string;
  test: { serial_no: number; name: string; description?: string } | null;
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
    tests_name: string;
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
    test: { serial_no: number; name: string } | null;
  }[];
  step_results: ReportStepResult[];
}

// Aliases for backwards compatibility
export type ModuleTestMeta = ReportMeta;
export type StepResultRow = ReportStepResult;

// ─────────────────────────────────────────────────────────────────────────────
// Drill-down queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch meta + step results for a single module_test (drill-down mode).
 */
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
        id, serial_no, action, expected_result, is_divider, tests_name
      )
    `
    )
    .eq("module_name", meta.module_name)
    .order("id");

  if (srErr) throw new Error(srErr.message);

  return {
    meta,
    results: (srData ?? []) as unknown as ReportStepResult[],
  };
}

/**
 * Re-fetch step results only (used for realtime refresh in drill-down mode).
 */
export async function fetchReportStepResults(
  module_name: string
): Promise<ReportStepResult[]> {
  const { data, error } = await supabase
    .from("step_results")
    .select(
      `
      id, status, remarks, display_name,
      step:test_steps!step_results_test_steps_id_fkey(
        id, serial_no, action, expected_result, is_divider, tests_name
      )
    `
    )
    .eq("module_name", module_name)
    .order("id");

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ReportStepResult[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Standalone module report queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch all module names for the filter dropdown.
 */
export async function fetchModuleOptions(): Promise<ModuleOption[]> {
  const { data } = await supabase.from("modules").select("name").order("name");
  return (data ?? []) as ModuleOption[];
}

/**
 * Fetch full module report data, optionally filtered by module name.
 */
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
        step:test_steps!test_steps_id(
          id, serial_no, action, expected_result, is_divider, tests_name
        )
      )
    `
    )
    .order("name", { ascending: true });

  if (selectedModuleName) query = (query as any).eq("name", selectedModuleName);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ModuleRow[];
}
