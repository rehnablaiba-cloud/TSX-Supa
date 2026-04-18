/**
 * queries.testreport.ts
 * All supabase data calls extracted from TestReport.tsx
 */
import supabase from "../../supabase";

export interface ReportModule {
  name:        string;
  description: string | null;
}

export interface ReportStep {
  id:             string;
  serialno:       number;
  testsname:      string;
  modulename:     string;
  action:         string;
  expectedresult: string;
  isdivider:      boolean;
}

export interface ReportStepResult {
  teststepsid: string;
  modulename:  string;
  status:      string;
  remarks:     string;
  displayname: string | null;
}

export interface TestReportData {
  modules:     ReportModule[];
  steps:       ReportStep[];
  stepResults: ReportStepResult[];
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
      .from("teststeps")
      .select("id, serialno, testsname, modulename, action, expectedresult, isdivider")
      .order("serialno", { ascending: true }),

    supabase
      .from("stepresults")
      .select("teststepsid, modulename, status, remarks, displayname"),
  ]);

  if (modulesRes.error) throw new Error(modulesRes.error.message);
  if (stepsRes.error)   throw new Error(stepsRes.error.message);
  if (resultsRes.error) throw new Error(resultsRes.error.message);

  return {
    modules:     (modulesRes.data  ?? []) as ReportModule[],
    steps:       (stepsRes.data    ?? []) as ReportStep[],
    stepResults: (resultsRes.data  ?? []) as ReportStepResult[],
  };
}

/**
 * Lightweight re-fetch of step results only — used when a realtime
 * update fires on the stepresults table (avoids re-fetching modules/steps).
 */
export async function fetchReportStepResults(
  moduleName?: string
): Promise<ReportStepResult[]> {
  let query = supabase
    .from("stepresults")
    .select("teststepsid, modulename, status, remarks, displayname");

  if (moduleName) query = query.eq("modulename", moduleName);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as ReportStepResult[];
}
