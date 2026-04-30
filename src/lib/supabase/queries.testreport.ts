/**
 * queries.testreport.ts
 *
 * Revision-aware update (2025):
 *  - fetchTestReportData and fetchModuleReports now also surface the active
 *    revision label (e.g. "R2") and is_visible flag for each test.
 *  - step_results are filtered to the active revision when one exists.
 */
import { supabase } from "../../supabase";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ReportMeta {
  module_name: string;
  tests_name: string;
  test: { serial_no: string; name: string; description?: string } | null;
  /** Active revision for this test, null if none has been activated yet. */
  active_revision: ReportRevision | null;
}

export interface ReportRevision {
  id: string;
  revision: string;
  is_visible: boolean;
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
    test: { serial_no: string; name: string } | null;
    /** Active revision for this test, if any. */
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
  // joined from test_steps
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

// Aliases
export type ModuleTestMeta = ReportMeta;
export type StepResultRow = ReportStepResult;

// ─────────────────────────────────────────────────────────────────────────────
// Helper: fetch active revision for a tests_serial_no
// ─────────────────────────────────────────────────────────────────────────────

async function fetchActiveRevision(
  tests_serial_no: string
): Promise<ReportRevision | null> {
  const { data, error } = await supabase
    .from("test_revisions")
    .select("id, revision, is_visible")
    .eq("tests_serial_no", tests_serial_no)
    .eq("status", "active")
    .maybeSingle();

  if (error || !data) return null;
  return data as ReportRevision;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: fetch step_results for a module, optionally scoped to a revision
// ─────────────────────────────────────────────────────────────────────────────

const SR_SELECT = `
  id, status, remarks, display_name,
  step:test_steps!step_results_test_steps_id_fkey(
    id, serial_no, action, expected_result, is_divider, tests_serial_no
  )
`;

async function fetchRevisionScopedResults(
  module_name: string,
  revision_id: string | null
): Promise<ReportStepResult[]> {
  let query = supabase
    .from("step_results")
    .select(SR_SELECT)
    .eq("module_name", module_name)
    .order("id");

  if (revision_id) {
    query = query.eq("revision_id", revision_id) as any;
  } else {
    // Legacy fallback: no revision yet → show rows where revision_id is null
    query = query.is("revision_id", null) as any;
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ReportStepResult[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Drill-down queries
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchTestReportData(
  module_test_id: string
): Promise<TestReportData> {
  // 1. Fetch module_test meta
  const { data: metaData, error: metaErr } = await supabase
    .from("module_tests")
    .select(
      "module_name, tests_name, test:tests!module_tests_tests_name_fkey(serial_no, name, description)"
    )
    .eq("id", module_test_id)
    .single();

  if (metaErr) throw new Error(metaErr.message);

  const rawMeta = metaData as any;
  const tests_serial_no: string = rawMeta?.test?.serial_no ?? "";

  // 2. Fetch active revision for this test
  const active_revision = await fetchActiveRevision(tests_serial_no);

  const meta: ReportMeta = {
    ...(rawMeta as ReportMeta),
    active_revision,
  };

  // 3. Fetch step_results scoped to active revision (or null fallback)
  const results = await fetchRevisionScopedResults(
    rawMeta.module_name,
    active_revision?.id ?? null
  );

  return { meta, results };
}

export async function fetchReportStepResults(
  module_name: string
): Promise<ReportStepResult[]> {
  // No revision scoping here — this is the full-module view used in reports
  // that display ALL tests together. Individual revision labels are surfaced via
  // fetchModuleReports which enriches each module_test.
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
  // 1. Fetch modules + their module_tests + step_results
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
    `
    )
    .order("name", { ascending: true });

  if (selectedModuleName) query = (query as any).eq("name", selectedModuleName);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as any[];

  // 2. Collect all tests_serial_nos across the result set
  const allSerialNos: string[] = Array.from(
    new Set(
      rows.flatMap((mod) =>
        ((mod.module_tests ?? []) as any[])
          .map((mt: any) => mt.test?.serial_no as string | undefined)
          .filter((s): s is string => !!s)
      )
    )
  );

  // 3. Batch-fetch active revisions for all tests
  const revisionsBySerialNo: Record<string, ReportRevision> = {};

  if (allSerialNos.length > 0) {
    const { data: revData, error: revErr } = await supabase
      .from("test_revisions")
      .select("id, revision, is_visible, tests_serial_no")
      .eq("status", "active")
      .in("tests_serial_no", allSerialNos);

    if (revErr) throw new Error(revErr.message);

    ((revData ?? []) as any[]).forEach((r) => {
      revisionsBySerialNo[r.tests_serial_no] = {
        id: r.id,
        revision: r.revision,
        is_visible: r.is_visible,
      };
    });
  }

  // 4. Enrich each module_test with its active_revision
  return rows.map((mod) => ({
    ...mod,
    module_tests: ((mod.module_tests ?? []) as any[]).map((mt) => ({
      ...mt,
      active_revision:
        revisionsBySerialNo[mt.test?.serial_no ?? ""] ?? null,
    })),
  })) as ModuleRow[];
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
