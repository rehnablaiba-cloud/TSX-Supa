// src/lib/supabase/queries.ts
import { supabase } from '../../supabase';
import type { ModuleOption, TestOption } from '../../types';

// ── Generic wrapper ───────────────────────────────────────────────────────────
export async function q<T>(
  table: string,
  query: (b: ReturnType<typeof supabase.from>) => Promise<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const { data, error } = await query(supabase.from(table));
  if (error) throw error;
  return data ?? [];
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export async function releaseLocksAndSignOut(
  userId: string,
  signOut: () => Promise<void>
): Promise<void> {
  try { await supabase.from('testlocks').delete().eq('userid', userId); }
  catch (err) { console.error('Failed to release locks on sign out', err); }
  await signOut();
}

// ── Module / Test options ─────────────────────────────────────────────────────
export async function fetchModuleOptions(): Promise<ModuleOption[]> {
  const { data, error } = await supabase.from('modules').select('name').order('name');
  if (error) throw error;
  return (data ?? []) as ModuleOption[];
}
export async function fetchModulesForSidebar(): Promise<ModuleOption[]> {
  return fetchModuleOptions();
}
export async function fetchTestsForModule(
  moduleName: string
): Promise<{ id: string; testsname: string }[]> {
  const { data, error } = await supabase
    .from('moduletests').select('id, testsname')
    .eq('modulename', moduleName).order('testsname');
  if (error) throw error;
  return (data ?? []) as { id: string; testsname: string }[];
}

// ── Export all ────────────────────────────────────────────────────────────────
export const ALL_TABLES = [
  'modules', 'moduletests', 'teststeps', 'stepresults',
  'testlocks', 'auditlog', 'users'
] as const;
export type AllData = Record<string, Record<string, unknown>[]>;

export async function fetchAllTables(): Promise<AllData> {
  const result: AllData = {};
  for (const table of ALL_TABLES) {
    const { data, error } = await supabase.from(table).select('*');
    if (error) throw error;
    result[table] = (data ?? []) as Record<string, unknown>[];
  }
  return result;
}

// ── AuditLog ──────────────────────────────────────────────────────────────────
export async function fetchAuditLog(
  limit = 200
): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase
    .from('auditlog').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as Record<string, unknown>[];
}

// ── Tests (for ImportStepsModal) ──────────────────────────────────────────────
export async function fetchTests(
  moduleName: string
): Promise<{ id: string; testsname: string }[]> {
  return fetchTestsForModule(moduleName);
}
export async function findStepBySerialNo(
  testId: string, serialno: number
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from('teststeps').select('*')
    .eq('moduletestid', testId).eq('serialno', serialno).maybeSingle();
  if (error) throw error;
  return data as Record<string, unknown> | null;
}
export async function bulkCreateSteps(
  steps: Record<string, unknown>[]
): Promise<void> {
  const { error } = await supabase.from('teststeps').insert(steps);
  if (error) throw error;
}
export async function updateStep(
  id: string, payload: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from('teststeps').update(payload).eq('id', id);
  if (error) throw error;
}
export async function deleteStep(id: string): Promise<void> {
  const { error } = await supabase.from('teststeps').delete().eq('id', id);
  if (error) throw error;
}

// ── TestExecution ─────────────────────────────────────────────────────────────
export * from './queries.testexecution';

// ── Re-exports from sub-query files ──────────────────────────────────────────
export * from './queries.mobilenav';
export * from './queries.moduledashboard';
export * from './queries.testreport';
