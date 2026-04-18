/**
 * queries.testreport.ts
 * All supabase data calls extracted from TestReport.tsx
 */
import {supabase} from "../../supabase";

export interface ReportModule {
  name:        string;
  description: string | null;
}

export interface ReportStep {
  id:             string;
  serial_no:       number;
  testsname:      string;
  module_name:     string;
  action:         string;
  expected_result: string;
  is_divider:      boolean;
}

export interface ReportStepResult {
  test_stepsid: string;
  module_name:  string;
  status:      string;
  remarks:     string;
  display_name: string | null;
}

export interface TestReportData {
  modules:     ReportModule[];
  steps:       ReportStep[];
  step_results: ReportStepResult[];
}

/**
 * Fetches all data needed to build the full test report in one parallel call.
 * Replaces the three inline supabase calls inside TestReport's load effect.
 */
export async function fetchTestReportData(): Promise<TestReportData> {
  const [modulesRes, stepsRes, resultsRes] = await Promise.all([
    supabase
      .from("modules")
      .select("name, description")
      .order("name"),

    supabase
      .from("test_steps")
      .select("id, serial_no, testsname, module_name, action, expected_result, is_divider")
      .order("serial_no", { ascending: true }),

    supabase
      .from("step_results")
      .select("test_stepsid, module_name, status, remarks, display_name"),
  ]);

  if (modulesRes.error) throw new Error(modulesRes.error.message);
  if (stepsRes.error)   throw new Error(stepsRes.error.message);
  if (resultsRes.error) throw new Error(resultsRes.error.message);

  return {
    modules:     (modulesRes.data  ?? []) as ReportModule[],
    steps:       (stepsRes.data    ?? []) as ReportStep[],
    step_results: (resultsRes.data  ?? []) as ReportStepResult[],
  };
}

/**
 * Lightweight re-fetch of step results only — used when a realtime
 * update fires on the step_results table (avoids re-fetching modules/steps).
 */
export async function fetchReportstep_results(
  module_name?: string
): Promise<ReportStepResult[]> {
  let query = supabase
    .from("step_results")
    .select("test_stepsid, module_name, status, remarks, display_name");

  if (module_name) query = query.eq("module_name", module_name);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as ReportStepResult[];
}
