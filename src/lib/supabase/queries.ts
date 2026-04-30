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
// NOTE: releaseLocksAndSignOut is defined HERE (not in queries.mobilenav) so
// that the try/catch wrapper is the canonical export. queries.mobilenav does
// NOT export this function — no duplicate conflict.
export async function releaseLocksAndSignOut(
  user_id: string,
  signOut: () => Promise<void>
): Promise<void> {
  try {
    // test_locks column for the user FK is locked_by (uuid)
    await supabase.from("test_locks").delete().eq("locked_by", user_id);
  } catch (err) {
    console.error("Failed to release locks on sign out", err);
  }
  await signOut();
}

// ── audit_log ─────────────────────────────────────────────────────────────────
// audit_log schema: { id, action, performed_by, performed_at, payload }
// NOTE: timestamp column is performed_at — NOT created_at
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
  const { data: t, error: tErr } = await supabase
    .from("tests").select("serial_no").eq("name", tests_name).single();
  if (tErr) return { written: 0, errors: [tErr.message] };

  const payload = rows.map((r) => ({ ...r, tests_serial_no: (t as any).serial_no }));

  const { error } = await supabase.from("test_steps").insert(payload);
  if (error) return { written: 0, errors: [error.message] };
  return { written: rows.length, errors: [] };
}

// ── Re-exports ────────────────────────────────────────────────────────────────
// queries.mobilenav: fetchModuleOptions, fetchTestsForModule, fetchAllTables,
//   ALL_TABLES, all CRUD for modules/tests/steps, AllData, ModuleOption, etc.
// NOTE: releaseLocksAndSignOut is NOT in queries.mobilenav — no conflict.
export * from "./queries.mobilenav";
export * from "./queries.moduledashboard";

// Selectively re-export from testreport to avoid ModuleOption collision
export {
  fetchTestReportData,
  fetchReportStepResults,
  fetchModuleReports,
  fetchSessionSteps,
  type ReportMeta,
  type ReportStepResult,
  type TestReportData,
  type ModuleRow,
  type ModuleTestMeta,
  type StepResultRow,
  type SessionStepEntry,
  type SessionTestGroup,
} from "./queries.testreport";

// Selectively re-export from testexecution to avoid conflicts
export {
  fetchTestExecution,
  acquireLock,
  releaseLock,
  forceReleaseLock,
  upsertStepResult,
  resetAllStepResults,
  fetchSignedUrls,
} from "./queries.testexecution";
