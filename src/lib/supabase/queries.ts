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
/** Returns all tests — no module filter needed for the CSV import flow */
export async function fetchTests(): Promise<TestOption[]> {
  const { data, error } = await supabase
    .from('tests').select('serialno, name').order('serialno');
  if (error) throw error;
  return (data ?? []) as TestOption[];
}

export async function findStepBySerialNo(
  testsname: string,
  serialno: number
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('teststeps').select('id')
    .eq('testsname', testsname).eq('serialno', serialno).maybeSingle();
  if (error) throw error;
  return data as { id: string } | null;
}

export async function bulkCreateSteps(
  testsname: string,
  rows: Record<string, unknown>[]
): Promise<{ written: number; errors: string[] }> {
  const payload = rows.map(r => ({ ...r, testsname }));
  const { error } = await supabase.from('teststeps').insert(payload);
  if (error) return { written: 0, errors: [error.message] };
  return { written: rows.length, errors: [] };
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

// ── Re-exports from sub-query files ──────────────────────────────────────────
// NOTE: queries.mobilenav exports fetchAllTables (with {data,errors} shape),
// ALL_TABLES, and AllData — those take precedence here.
export * from './queries.mobilenav';
export * from './queries.moduledashboard';
export * from './queries.testreport';

// Selectively re-export from testexecution to avoid RawStepResult collision
export {
  fetchTestExecution,
  acquireLock,
  releaseLock,
  forceReleaseLock,
  upsertStepResult,
  resetAllStepResults,
  fetchSignedUrls,
} from './queries.testexecution';