/**
 * queries.mobilenav.ts
 * All supabase data calls extracted from MobileNav.tsx (admin modals).
 * Merge / re-export these from your central queries.ts if desired.
 */

import {supabase} from "../../supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TableName =
  | "profiles" | "modules"  | "tests"       | "test_steps"
  | "module_tests" | "step_results" | "test_locks" | "audit_log";

export type AllData = Record<TableName, Record<string, unknown>[]>;

export interface ModuleOption { name: string }
export interface TestOption   { serial_no: string; name: string }
export interface StepOption   {
  id: string;
  serial_no: number;
  testsname: string;
  action: string;
  expected_result: string;
  is_divider: boolean;
}
export interface CsvStepRow {
  testsname:      string;
  serial_no:       number;
  action:         string;
  expected_result: string;
  is_divider:      boolean;
}
export interface ManualStepPayload {
  testsname:      string;
  serial_no:       number;
  action:         string;
  expected_result: string;
  is_divider:      boolean;
}

// ─── Export-dump ──────────────────────────────────────────────────────────────

export const ALL_TABLES: TableName[] = [
  "profiles", "modules", "tests", "test_steps",
  "module_tests", "step_results", "test_locks", "audit_log",
];

/**
 * Fetches every row from every table for the full-DB export dump.
 * Replaces the local fetchAllTables() inside MobileNav.tsx.
 */
export async function fetchAllTables(): Promise<{
  data:   AllData;
  errors: string[];
}> {
  const data = {} as AllData;
  const errors: string[] = [];

  await Promise.all(
    ALL_TABLES.map(async table => {
      const { data: rows, error } = await supabase.from(table).select("*");
      if (error) errors.push(`${table}: ${error.message}`);
      else       data[table] = rows ?? [];
    })
  );

  return { data, errors };
}

// ─── Modules CRUD ─────────────────────────────────────────────────────────────

/** Load all modules — used in ImportModulesModal select-module stage. */
export async function fetchModuleOptions(): Promise<ModuleOption[]> {
  const { data, error } = await supabase
    .from("modules")
    .select("name")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as ModuleOption[];
}

export async function createModule(name: string): Promise<void> {
  const { error } = await supabase.from("modules").insert({ name });
  if (error) throw error;
}

export async function updateModule(oldName: string, newName: string): Promise<void> {
  const { error } = await supabase
    .from("modules")
    .update({ name: newName })
    .eq("name", oldName);
  if (error) throw error;
}

export async function deleteModule(name: string): Promise<void> {
  const { error } = await supabase.from("modules").delete().eq("name", name);
  if (error) throw error;
}

// ─── Tests CRUD ───────────────────────────────────────────────────────────────

/** Load all tests — used in ImportTestsModal select-test stage. */
export async function fetchTestOptions(): Promise<TestOption[]> {
  const { data, error } = await supabase
    .from("tests")
    .select("serial_no, name")
    .order("serial_no", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as TestOption[];
}

export async function createTest(serial_no: string, name: string): Promise<void> {
  const { error } = await supabase.from("tests").insert({ serial_no, name });
  if (error) throw error;
}

export async function updateTest(oldName: string, newName: string): Promise<void> {
  const { error } = await supabase
    .from("tests")
    .update({ name: newName })
    .eq("name", oldName);
  if (error) throw error;
}

export async function deleteTest(name: string): Promise<void> {
  const { error } = await supabase.from("tests").delete().eq("name", name);
  if (error) throw error;
}

// ─── Steps — CSV bulk import ──────────────────────────────────────────────────

/**
 * Fetch tests that belong to a given module.
 * Used in the CSV step-import flow to populate the test picker.
 */
export async function fetchTestsForModule(module_name: string): Promise<TestOption[]> {
  const { data, error } = await supabase
    .from("module_tests")
    .select("testsname, tests(serial_no, name)")
    .eq("module_name", module_name);
  if (error) throw new Error(error.message);

  const tests = ((data ?? []) as any[])
    .map(r => r.tests)
    .flat()
    .filter(Boolean) as TestOption[];

  tests.sort((a, b) =>
    String(a.serial_no).localeCompare(String(b.serial_no), undefined, { numeric: true })
  );
  return tests;
}

/**
 * Fetch existing steps for a test.
 * Used to build the diff/preview in the CSV import confirm stage.
 */
export async function fetchStepsForTest(testsname: string): Promise<StepOption[]> {
  const { data, error } = await supabase
    .from("test_steps")
    .select("id, serial_no, testsname, action, expected_result, is_divider")
    .eq("testsname", testsname)
    .order("serial_no", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as StepOption[];
}

/**
 * Bulk-replace all steps for a test:
 *  1. Delete all existing rows for the test.
 *  2. Insert new rows from the parsed CSV.
 */
export async function replaceCsvSteps(
  testsname: string,
  rows: CsvStepRow[]
): Promise<void> {
  const { error: delErr } = await supabase
    .from("test_steps")
    .delete()
    .eq("testsname", testsname);
  if (delErr) throw delErr;

  if (rows.length === 0) return;

  const { error: insErr } = await supabase.from("test_steps").insert(rows);
  if (insErr) throw insErr;
}

// ─── Steps — Manual CRUD ──────────────────────────────────────────────────────

/** Load steps for a given test — ImportStepsManualModal select-step stage. */
export async function fetchStepOptions(testsname: string): Promise<StepOption[]> {
  const { data, error } = await supabase
    .from("test_steps")
    .select("id, serial_no, testsname, action, expected_result, is_divider")
    .eq("testsname", testsname)
    .order("serial_no", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as StepOption[];
}

export async function createStep(payload: ManualStepPayload): Promise<void> {
  const { error } = await supabase.from("test_steps").insert(payload);
  if (error) throw error;
}

export async function updateStep(
  id: string,
  patch: { action: string; expected_result: string; is_divider: boolean }
): Promise<void> {
  const { error } = await supabase
    .from("test_steps")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteStep(id: string): Promise<void> {
  const { error } = await supabase.from("test_steps").delete().eq("id", id);
  if (error) throw error;
}

// ─── Sign-out cleanup ─────────────────────────────────────────────────────────

/**
 * Release all test locks held by this user then call signOut().
 * Replaces the inline supabase.from("test_locks").delete() in handleSignOut.
 */
export async function releaseLocksAndSignOut(
  user_id: string,
  signOut: () => Promise<void>
): Promise<void> {
  await supabase.from("test_locks").delete().eq("user_id", user_id);
  await signOut();
}
