// src/lib/supabase/queries.ts
import { supabase } from "../../supabase";
import type { ModuleOption, TestOption } from "../../types";

// ── Generic wrapper ───────────────────────────────────────────────────────────
export async function q<T>(
  table: string,
  query: (
    b: ReturnType<typeof supabase.from>
  ) => Promise<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const { data, error } = await query(supabase.from(table));
  if (error) throw error;
  return data ?? [];
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export async function releaseLocksAndSignOut(
  user_id: string,
  signOut: () => Promise<void>
): Promise<void> {
  try {
    // test_locks uses locked_by (uuid), not user_id
    await supabase.from("test_locks").delete().eq("locked_by", user_id);
  } catch (err) {
    console.error("Failed to release locks on sign out", err);
  }
  await signOut();
}

// ── Module / Test options ─────────────────────────────────────────────────────
export async function fetchModuleOptions(): Promise<ModuleOption[]> {
  const { data, error } = await supabase
    .from("modules")
    .select("name")
    .order("name");
  if (error) throw error;
  return (data ?? []) as ModuleOption[];
}
export async function fetchModulesForSidebar(): Promise<ModuleOption[]> {
  return fetchModuleOptions();
}

/**
 * Returns tests belonging to a module via the module_tests junction.
 * module_tests schema: { module_name, test_name }
 *   - test_name is FK → tests.serial_no  (NOT tests.name, NOT tests_name)
 *   - there is no `id` column on module_tests
 */
export async function fetchTestsForModule(
  module_name: string
): Promise<{ serial_no: string; name: string }[]> {
  const { data, error } = await supabase
    .from("module_tests")
    .select("tests(serial_no, name)")
    .eq("module_name", module_name);
  if (error) throw error;
  return ((data ?? []) as any[])
    .map(r => r.tests)
    .filter(Boolean) as { serial_no: string; name: string }[];
}

// ── audit_log ──────────────────────────────────────────────────────────────────
// audit_log schema: { id, action, performed_by, performed_at, payload }
// NOTE: the timestamp column is performed_at — NOT created_at
export async function fetchaudit_log(
  limit = 200
): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase
    .from("audit_log")
    .select("*")
    .order("performed_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Record<string, unknown>[];
}

// ── Tests (for ImportStepsModal) ──────────────────────────────────────────────
/** Returns all tests — no module filter needed for the CSV import flow */
export async function fetchTests(): Promise<TestOption[]> {
  const { data, error } = await supabase
    .from("tests")
    .select("serial_no, name")
    .order("serial_no");
  if (error) throw error;
  return (data ?? []) as TestOption[];
}

export async function findStepByserial_no(
  tests_name: string,
  serial_no: number
): Promise<{ id: string } | null> {
  // Resolve tests_name → serial_no first
  const { data: t, error: tErr } = await supabase
    .from("tests").select("serial_no").eq("name", tests_name).single();
  if (tErr) throw tErr;

  const { data, error } = await supabase
    .from("test_steps")
    .select("id")
    .eq("tests_serial_no", (t as any).serial_no)
    .eq("serial_no", serial_no)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string } | null;
}

export async function bulkCreateSteps(
  tests_name: string,
  rows: Record<string, unknown>[]
): Promise<{ written: number; errors: string[] }> {
  // Resolve tests_name → serial_no
  const { data: t, error: tErr } = await supabase
    .from("tests").select("serial_no").eq("name", tests_name).single();
  if (tErr) return { written: 0, errors: [tErr.message] };

  const payload = rows.map((r) => ({ ...r, tests_serial_no: (t as any).serial_no }));

  const { error } = await supabase.from("test_steps").insert(payload);
  if (error) return { written: 0, errors: [error.message] };
  return { written: rows.length, errors: [] };
}

// ── Re-exports from sub-query files ──────────────────────────────────────────
// NOTE: queries.mobilenav exports fetchAllTables (with {data,errors} shape),
// ALL_TABLES, and AllData — those take precedence here.
export * from "./queries.mobilenav";
export * from "./queries.moduledashboard";

// Selectively re-export from testreport to avoid ModuleOption collision
// (ModuleOption is already exported via queries.mobilenav)
export {
  fetchTestReportData,
  fetchReportStepResults,
  fetchModuleReports,
  type ReportMeta,
  type ReportStepResult,
  type TestReportData,
  type ModuleRow,
  type ModuleTestMeta,
  type StepResultRow,
} from "./queries.testreport";

// Selectively re-export from testexecution to avoid RawStepResult collision
export {
  fetchTestExecution,
  acquireLock,
  releaseLock,
  forceReleaseLock,
  upsertStepResult,
  resetAllStepResults,
  fetchSignedUrls,
} from "./queries.testexecution";