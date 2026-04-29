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
  tests_serial_no: string;
  action: string;
  expected_result: string;
  is_divider: boolean;
}
export interface CsvStepRow {
  tests_serial_no: string;
  serial_no: number;
  action: string;
  expected_result: string;
  is_divider: boolean;
}
export interface ManualStepPayload {
  tests_serial_no: string;
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
  // The AFTER INSERT trigger on tests auto-creates a default R0 draft revision
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
 * Fully delete a test and all child rows in FK dependency order.
 *
 * Deletion order:
 *  1. step_results       (FK → test_steps.id via test_steps_id)
 *  2. test_revisions     (FK → tests.serial_no via tests_serial_no)
 *     — step_order JSONB refs become orphaned but test_steps rows stay per invariant
 *  3. test_steps         (FK → tests.serial_no via tests_serial_no)
 *     NOTE: deleting test_steps violates the append-only invariant in production;
 *     this is only appropriate for admin purge of test definitions.
 *  4. module_tests       (FK → tests.serial_no via test_name)
 *  5. test_locks         (FK → tests.serial_no via test_name)
 *  6. tests
 */
export async function deleteTestCascade(name: string): Promise<void> {
  await assertAdmin();

  // Resolve display name → serial_no (the actual PK / FK key)
  const { data: testRow, error: testErr } = await supabase
    .from("tests")
    .select("serial_no")
    .eq("name", name)
    .single();
  if (testErr) throw new Error(`Test lookup failed: ${testErr.message}`);
  const serial_no = (testRow as any).serial_no as string;

  // 1. Collect all step ids for this test (needed to delete step_results)
  const { data: steps, error: stepsErr } = await supabase
    .from("test_steps")
    .select("id")
    .eq("tests_serial_no", serial_no);
  if (stepsErr) throw new Error(`Step fetch failed: ${stepsErr.message}`);

  const stepIds = (steps ?? []).map((s: any) => s.id);

  // 2. Delete step_results for those steps
  if (stepIds.length > 0) {
    const { error: srErr } = await supabase
      .from("step_results")
      .delete()
      .in("test_steps_id", stepIds);
    if (srErr) throw new Error(`step_results cleanup failed: ${srErr.message}`);
  }

  // 3. Delete test_revisions (FK: tests_serial_no → tests.serial_no)
  const { error: trErr } = await supabase
    .from("test_revisions")
    .delete()
    .eq("tests_serial_no", serial_no);
  if (trErr) throw new Error(`test_revisions cleanup failed: ${trErr.message}`);

  // 4. Delete test_steps (FK: tests_serial_no → tests.serial_no)
  const { error: tsErr } = await supabase
    .from("test_steps")
    .delete()
    .eq("tests_serial_no", serial_no);
  if (tsErr) throw new Error(`test_steps cleanup failed: ${tsErr.message}`);

  // 5. Delete module_tests (FK: test_name → tests.serial_no — value is serial_no)
  const { error: mtErr } = await supabase
    .from("module_tests")
    .delete()
    .eq("test_name", serial_no);
  if (mtErr) throw new Error(`module_tests cleanup failed: ${mtErr.message}`);

  // 6. Delete test_locks (FK: test_name → tests.serial_no — value is serial_no)
  const { error: tlErr } = await supabase
    .from("test_locks")
    .delete()
    .eq("test_name", serial_no);
  if (tlErr) throw new Error(`test_locks cleanup failed: ${tlErr.message}`);

  // 7. Delete the test itself
  const { error } = await supabase.from("tests").delete().eq("name", name);
  if (error) throw new Error(error.message);
}

// ─── Steps — fetch ────────────────────────────────────────────────────────────

/**
 * Fetch steps for a test via RPC.
 * Avoids PostgREST URL-encoding issues when test names contain spaces.
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
 * Resolves display name → serial_no first since test_steps uses tests_serial_no.
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
    .eq("tests_serial_no", (t as any).serial_no)
    .order("serial_no", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as StepOption[];
}

/**
 * Fetch tests that belong to a given module.
 * module_tests schema: { module_name, test_name }
 *   test_name is FK → tests.serial_no
 */
export async function fetchTestsForModule(
  module_name: string
): Promise<TestOption[]> {
  const { data, error } = await supabase
    .from("module_tests")
    .select("test_name, tests(serial_no, name)")
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
 * Resolves display name → serial_no first.
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
    .eq("tests_serial_no", (t as any).serial_no)
    .order("serial_no", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as StepOption[];
}

// ─── Steps — CSV bulk import ──────────────────────────────────────────────────

/**
 * @deprecated Schema invariant: test_steps rows are append-only and must never
 * be deleted. This function performs a full DELETE+INSERT which destroys
 * historical step references. Use the revision-based import flow
 * (ImportStepsModal → buildFirstRevisionPayload / buildDiffRevisionPayload)
 * instead.
 */
export async function replaceCsvSteps(
  tests_name: string,
  rows: CsvStepRow[]
): Promise<void> {
  await assertAdmin();

  const { data: t, error: tErr } = await supabase
    .from("tests")
    .select("serial_no")
    .eq("name", tests_name)
    .single();
  if (tErr) throw new Error(tErr.message);

  const { error: delErr } = await supabase
    .from("test_steps")
    .delete()
    .eq("tests_serial_no", (t as any).serial_no);
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

/**
 * @deprecated Schema invariant: test_steps rows are append-only and must never
 * be updated in-place. To edit a step, insert a new row with origin_step_id
 * pointing to the old row and update the parent revision's step_order JSONB.
 */
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

/**
 * @deprecated Schema invariant: test_steps rows are append-only and must never
 * be deleted. To remove a step from a revision, remove its id from the
 * revision's step_order JSONB — the row stays forever.
 */
export async function deleteStep(id: string): Promise<void> {
  await assertAdmin();
  const { error } = await supabase.from("test_steps").delete().eq("id", id);
  if (error) throw error;
}

/**
 * @deprecated See deleteStep — step rows must not be deleted per schema invariant.
 * Removing step_results is acceptable for a test purge (deleteTestCascade) but
 * should not be done on an individual step during normal test execution lifecycle.
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
  // test_locks uses locked_by (uuid), not user_id
  await supabase.from("test_locks").delete().eq("locked_by", user_id);
  await signOut();
}