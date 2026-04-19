// src/lib/supabase/queries.mobilenav.ts
// Imported directly by: MobileNav.tsx, ImportModulesModal.tsx,
//                       ImportTestsModal.tsx, ImportStepsModal.tsx,
//                       ImportStepsManualModal.tsx, ExportAllModal.tsx

import { supabase } from '../../supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export type TableName =
  | 'profiles' | 'modules'      | 'tests'        | 'test_steps'
  | 'module_tests' | 'step_results' | 'test_locks' | 'audit_log';

export type AllData = Record<TableName, Record<string, unknown>[]>;

export interface ModuleOption { name: string }
export interface TestOption   { serial_no: string; name: string }

export interface StepOption {
  id:              string;
  serial_no:       number;
  tests_name:      string;   // ✅ was testsname
  action:          string;
  expected_result: string;
  is_divider:      boolean;
}

export interface CsvStepRow {
  tests_name:      string;   // ✅ was testsname
  serial_no:       number;
  action:          string;
  expected_result: string;
  is_divider:      boolean;
}

export interface ManualStepPayload {
  tests_name:      string;   // ✅ was testsname
  serial_no:       number;
  action:          string;
  expected_result: string;
  is_divider:      boolean;
}

// ── Export dump ───────────────────────────────────────────────────────────────

export const ALL_TABLES: TableName[] = [
  'profiles', 'modules', 'tests', 'test_steps',
  'module_tests', 'step_results', 'test_locks', 'audit_log',
];

export async function fetchAllTables(): Promise<{ data: AllData; errors: string[] }> {
  const data = {} as AllData;
  const errors: string[] = [];
  await Promise.all(
    ALL_TABLES.map(async table => {
      const { data: rows, error } = await supabase.from(table).select('*');
      if (error) errors.push(`${table}: ${error.message}`);
      else       data[table] = rows ?? [];
    })
  );
  return { data, errors };
}

// ── Modules CRUD ──────────────────────────────────────────────────────────────

export async function fetchModuleOptions(): Promise<ModuleOption[]> {
  const { data, error } = await supabase
    .from('modules')
    .select('name')
    .order('name');
  if (error) throw new Error(error.message);
  return (data ?? []) as ModuleOption[];
}

export async function createModule(name: string): Promise<void> {
  const { error } = await supabase.from('modules').insert({ name });
  if (error) throw error;
}

export async function updateModule(oldName: string, newName: string): Promise<void> {
  const { error } = await supabase
    .from('modules')
    .update({ name: newName })
    .eq('name', oldName);
  if (error) throw error;
}

export async function deleteModule(name: string): Promise<void> {
  const { error } = await supabase.from('modules').delete().eq('name', name);
  if (error) throw error;
}

// ── Tests CRUD ────────────────────────────────────────────────────────────────

export async function fetchTestOptions(): Promise<TestOption[]> {
  const { data, error } = await supabase
    .from('tests')
    .select('serial_no, name')
    .order('serial_no', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as TestOption[];
}

export async function createTest(serial_no: string, name: string): Promise<void> {
  const { error } = await supabase.from('tests').insert({ serial_no, name });
  if (error) throw error;
}

export async function updateTest(oldName: string, newName: string): Promise<void> {
  const { error } = await supabase
    .from('tests')
    .update({ name: newName })
    .eq('name', oldName);
  if (error) throw error;
}

export async function deleteTest(name: string): Promise<void> {
  const { error } = await supabase.from('tests').delete().eq('name', name);
  if (error) throw error;
}

// ── Steps — CSV bulk import ───────────────────────────────────────────────────

/**
 * Fetch tests that belong to a given module.
 * Used in the CSV step-import flow to populate the test picker.
 */
export async function fetchTestsForModule(module_name: string): Promise<TestOption[]> {
  const { data, error } = await supabase
    .from('module_tests')
    .select('tests_name, tests!module_tests_tests_name_fkey(serial_no, name)') // ✅ was testsname
    .eq('module_name', module_name);
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
export async function fetchStepsForTest(tests_name: string): Promise<StepOption[]> { // ✅ was testsname
  const { data, error } = await supabase
    .from('test_steps')
    .select('id, serial_no, tests_name, action, expected_result, is_divider') // ✅ was testsname
    .eq('tests_name', tests_name)   // ✅ was testsname
    .order('serial_no', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as StepOption[];
}

/**
 * Bulk-replace all steps for a test:
 *  1. Delete all existing rows for the test.
 *  2. Insert new rows from the parsed CSV.
 */
export async function replaceCsvSteps(tests_name: string, rows: CsvStepRow[]): Promise<void> { // ✅ was testsname
  const { error: delErr } = await supabase
    .from('test_steps')
    .delete()
    .eq('tests_name', tests_name);  // ✅ was testsname
  if (delErr) throw delErr;
  if (rows.length === 0) return;
  const { error: insErr } = await supabase.from('test_steps').insert(rows);
  if (insErr) throw insErr;
}

/**
 * Locate a single step by test + serial_no.
 * Used in the CSV import flow to detect duplicates before inserting.
 */
export async function findStepBySerialNo(  // ✅ renamed from findStepByserial_no (casing)
  tests_name: string,                      // ✅ was testsname
  serial_no: number
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('test_steps')
    .select('id')
    .eq('tests_name', tests_name)          // ✅ was testsname
    .eq('serial_no', serial_no)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string } | null;
}

/**
 * Bulk-insert steps without deleting existing ones first.
 * Used in the append variant of the CSV import flow.
 */
export async function bulkCreateSteps(
  tests_name: string,                      // ✅ was testsname
  rows: Record<string, unknown>[]
): Promise<{ written: number; errors: string[] }> {
  const payload = rows.map(r => ({ ...r, tests_name }));  // ✅ was testsname
  const { error } = await supabase.from('test_steps').insert(payload);
  if (error) return { written: 0, errors: [error.message] };
  return { written: rows.length, errors: [] };
}

// ── Steps — Manual CRUD ───────────────────────────────────────────────────────

export async function fetchStepOptions(tests_name: string): Promise<StepOption[]> { // ✅ was testsname
  const { data, error } = await supabase
    .from('test_steps')
    .select('id, serial_no, tests_name, action, expected_result, is_divider') // ✅ was testsname
    .eq('tests_name', tests_name)   // ✅ was testsname
    .order('serial_no', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as StepOption[];
}

export async function createStep(payload: ManualStepPayload): Promise<void> {
  const { error } = await supabase.from('test_steps').insert(payload);
  if (error) throw error;
}

export async function updateStep(
  id: string,
  patch: { action: string; expected_result: string; is_divider: boolean }
): Promise<void> {
  const { error } = await supabase.from('test_steps').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteStep(id: string): Promise<void> {
  const { error } = await supabase.from('test_steps').delete().eq('id', id);
  if (error) throw error;
}
