/**
 * queries.mobilenav.ts
 * Supabase data calls extracted from MobileNav.tsx (admin modals).
 */

import { supabase } from "../../supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TableName =
  | "profiles"
  | "modules"
  | "tests"
  | "test_steps"
  | "module_tests"
  | "step_results"
  | "test_locks"
  | "audit_log";

export type AllData = Record<TableName, Record<string, unknown>[]>;

export interface ModuleOption {
  name: string;
}
export interface TestOption {
  serial_no: string;
  name: string;
}
export interface StepOption {
  id: string;
  serial_no: number;
  tests_serial_no: string; // ← was tests_name
  action: string;
  expected_result: string;
  is_divider: boolean;
}
export interface CsvStepRow {
  tests_serial_no: string; // ← was tests_name
  serial_no: number;
  action: string;
  expected_result: string;
  is_divider: boolean;
}
export interface ManualStepPayload {
  tests_serial_no: string; // ← was tests_name
  serial_no: number;
  action: string;
  expected_result: string;
  is_divider: boolean;
}

// ─── Admin guard ──────────────────────────────────────────────────────────────

async function assertAdmin(): Promise<void> {
  const { data, error } = await supabase.rpc("is_admin");
  if (error) throw new Error(`Admin check failed: ${error.message}`);
  if (!data) throw new Error("Forbidden: admin privileges required.");
}

// ─── Export-dump ──────────────────────────────────────────────────────────────

export const ALL_TABLES: TableName[] = [
  "profiles",
  "modules",
  "tests",
  "test_steps",
  "module_tests",
  "step_results",
  "test_locks",
  "audit_log",
];

export async function fetchAllTables(): Promise<{
  data: AllData;
  errors: string[];
}> {
  await assertAdmin();

  const data = {} as AllData;
  const errors: string[] = [];

  await Promise.all(
    ALL_TABLES.map(async (table) => {
      const { data: rows, error } = await supabase.from(table).select("*");
      if (error) errors.push(`${table}: ${error.message}`);
      else data[table] = rows ?? [];
    })
  );

  return { data, errors };
}

// ─── Modules CRUD ─────────────────────────────────────────────────────────────

export async function fetchModuleOptions(): Promise<ModuleOption[]> {
  const { data, error } = await supabase
    .from("modules")
    .select("name")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as ModuleOption[];
}

export async function createModule(name: string): Promise<void> {
  await assertAdmin();
  const { error } = await supabase.from("modules").insert({ name });
  if (error) throw error;
}

export async function updateModule(
  oldName: string,
  newName: string
): Promise<void> {
  await assertAdmin();
  const { error } = await supabase
    .from("modules")
    .update({ name: newName })
    .eq("name", oldName);
  if (error) throw error;
}

export async function deleteModule(name: string): Promise<void> {
  await assertAdmin();
  const { error } = await supabase.from("modules").delete().eq("name", name);
  if (error) throw error;
}

// ─── Tests CRUD ───────────────────────────────────────────────────────────────

export async function fetchTestOptions(): Promise<TestOption[]> {
  const { data, error } = await supabase
    .from("tests")
    .select("serial_no, name")
    .order("serial_no", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as TestOption[];
}

export async function createTest(
  serial_no: string,
  name: string
): Promise<void> {
  await assertAdmin();
  const { error } = await supabase.from("tests").insert({ serial_no, name });
  if (error) throw error;
}

export async function updateTest(
  oldName: string,
  newName: string,
  newSerialNo: string
): Promise<void> {
  await assertAdmin();
  const { error } = await supabase
    .from("tests")
    .update({ serial_no: newSerialNo, name: newName })
    .eq("name", oldName);
  if (error) throw new Error(error.message);
}

/**
 * Fully delete a test and all child rows in FK dependency order:
 *  1. step_results  (FK → test_steps)
 *  2. test_steps    (FK → tests via tests_serial_no)
 *  3. module_tests  (FK → tests via tests_name)
 *  4. tests
 */
export async function deleteTestCascade(name: string): Promise<void> {
  await assertAdmin();

  // Resolve tests_name → serial_no first
  const { data: testRow, error: testErr } = await supabase
    .from("tests")
    .select("serial_no")
    .eq("name", name)
    .single();
  if (testErr) throw new Error(`Test lookup failed: ${testErr.message}`);
  const serial_no = (testRow as any).serial_no;

  const { data: steps, error: stepsErr } = await supabase
    .from("test_steps")
    .select("id")
    .eq("tests_serial_no", serial_no); // ← was .eq("tests_name", name)
  if (stepsErr) throw new Error(`Step fetch failed: ${stepsErr.message}`);

  const stepIds = (steps ?? []).map((s: any) => s.id);

  if (stepIds.length > 0) {
    const { error: srErr } = await supabase
      .from("step_results")
      .delete()
      .in("test_steps_id", stepIds);
    if (srErr) throw new Error(`step_results cleanup failed: ${srErr.message}`);
  }

  const { error: tsErr } = await supabase
    .from("test_steps")
    .delete()
    .eq("tests_serial_no", serial_no); // ← was .eq("tests_name", name)
  if (tsErr) throw new Error(`test_steps cleanup failed: ${tsErr.message}`);

  const { error: mtErr } = await supabase
    .from("module_tests")
    .delete()
    .eq("tests_name", name); // stays: module_tests still uses tests_name
  if (mtErr) throw new Error(`module_tests cleanup failed: ${mtErr.message}`);

  const { error } = await supabase.from("tests").delete().eq("name", name);
  if (error) throw new Error(error.message);
}

// ─── Steps — fetch ────────────────────────────────────────────────────────────

/**
 * Fetch steps for a test via RPC.
 * Avoids PostgREST URL-encoding bug when test names contain spaces.
 */
export async function fetchStepsByTest(
  tests_name: string
): Promise<StepOption[]> {
  const { data, error } = await supabase.rpc("get_steps_by_test", {
    p_tests_name: tests_name,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as StepOption[];
}

/**
 * Fetch steps for a test — direct query variant.
 * Resolves tests_name → serial_no first since test_steps uses tests_serial_no.
 */
export async function fetchStepOptions(
  tests_name: string
): Promise<StepOption[]> {
  const { data: t, error: tErr } = await supabase
    .from("tests")
    .select("serial_no")
    .eq("name", tests_name)
    .single();
  if (tErr) throw new Error(tErr.message);

  const { data, error } = await supabase
    .from("test_steps")
    .select("id, serial_no, tests_serial_no, action, expected_result, is_divider")
    .eq("tests_serial_no", (t as any).serial_no) // ← was .eq("tests_name", tests_name)
    .order("serial_no", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as StepOption[];
}

/**
 * Fetch tests that belong to a given module.
 */
export async function fetchTestsForModule(
  module_name: string
): Promise<TestOption[]> {
  const { data, error } = await supabase
    .from("module_tests")
    .select("tests_name, tests(serial_no, name)")
    .eq("module_name", module_name);
  if (error) throw new Error(error.message);

  const tests = ((data ?? []) as any[])
    .map((r) => r.tests)
    .flat()
    .filter(Boolean) as TestOption[];

  tests.sort((a, b) =>
    String(a.serial_no).localeCompare(String(b.serial_no), undefined, {
      numeric: true,
    })
  );
  return tests;
}

/**
 * Fetch existing steps for a test — used for diff/preview in CSV import.
 * Resolves tests_name → serial_no first.
 */
export async function fetchStepsForTest(
  tests_name: string
): Promise<StepOption[]> {
  const { data: t, error: tErr } = await supabase
    .from("tests")
    .select("serial_no")
    .eq("name", tests_name)
    .single();
  if (tErr) throw new Error(tErr.message);

  const { data, error } = await supabase
    .from("test_steps")
    .select("id, serial_no, tests_serial_no, action, expected_result, is_divider")
    .eq("tests_serial_no", (t as any).serial_no) // ← was .eq("tests_name", tests_name)
    .order("serial_no", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as StepOption[];
}

// ─── Steps — CSV bulk import ──────────────────────────────────────────────────

export async function replaceCsvSteps(
  tests_name: string,
  rows: CsvStepRow[] // CsvStepRow now carries tests_serial_no
): Promise<void> {
  await assertAdmin();

  // Resolve tests_name → serial_no
  const { data: t, error: tErr } = await supabase
    .from("tests")
    .select("serial_no")
    .eq("name", tests_name)
    .single();
  if (tErr) throw new Error(tErr.message);

  const { error: delErr } = await supabase
    .from("test_steps")
    .delete()
    .eq("tests_serial_no", (t as any).serial_no); // ← was .eq("tests_name", tests_name)
  if (delErr) throw delErr;

  if (rows.length === 0) return;

  const { error: insErr } = await supabase.from("test_steps").insert(rows);
  if (insErr) throw insErr;
}

// ─── Steps — Manual CRUD ──────────────────────────────────────────────────────

export async function createStep(payload: ManualStepPayload): Promise<void> {
  await assertAdmin();
  const { error } = await supabase.from("test_steps").insert(payload);
  if (error) throw error;
}

export async function updateStep(
  id: string,
  patch: { action: string; expected_result: string; is_divider: boolean }
): Promise<void> {
  await assertAdmin();
  const { error } = await supabase
    .from("test_steps")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteStep(id: string): Promise<void> {
  await assertAdmin();
  const { error } = await supabase.from("test_steps").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Delete a step AND its associated step_results.
 * step_results has a FK → test_steps so children must be removed first.
 */
export async function deleteStepWithResults(id: string): Promise<void> {
  await assertAdmin();

  const { error: resErr } = await supabase
    .from("step_results")
    .delete()
    .eq("test_steps_id", id);
  if (resErr) throw new Error(`Result cleanup failed: ${resErr.message}`);

  const { error } = await supabase.from("test_steps").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ─── Sign-out cleanup ─────────────────────────────────────────────────────────

export async function releaseLocksAndSignOut(
  user_id: string,
  signOut: () => Promise<void>
): Promise<void> {
  await supabase.from("test_locks").delete().eq("user_id", user_id);
  await signOut();
}
