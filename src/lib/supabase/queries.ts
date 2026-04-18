// src/lib/supabase/queries.ts
// Central shared query layer.
// Phase 1: modules list, sign-out lock
// Phase 2 (A1): q<T> shared wrapper — replaces 3-line error pattern repeated ~30×
//         (A3): single releaseLocksAndSignOut definition
//         (A4): single fetchModuleOptions definition
//         (A5): single fetchTestsForModule definition

import supabase from '../../supabase';
import type { Module, TestOption, ModuleOption } from '../../types';

// ── A1: Shared throw-on-error wrapper ─────────────────────────────────────────
// Usage: return q<MyType>(supabase.from('table').select('...'));
// Eliminates the repeated:
//   const { data, error } = await ...;
//   if (error) throw new Error(error.message);
//   return (data ?? []) as T[];
export async function q<T>(
  promise: PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ── A4: fetchModuleOptions ─────────────────────────────────────────────────────
// Single definition — previously duplicated in queries.dashboard.ts
// and queries.mobilenav.ts
export async function fetchModuleOptions(): Promise<ModuleOption[]> {
  return q<ModuleOption>(
    supabase.from('modules').select('name, description').order('name')
  );
}

// ── A5: fetchTestsForModule ────────────────────────────────────────────────────
// Single definition — previously duplicated in queries.mobilenav.ts
// and queries.moduledashboard.ts
export async function fetchTestsForModule(
  moduleName: string
): Promise<{ id: string; testsname: string }[]> {
  return q(
    supabase
      .from('moduletests')
      .select('id, testsname')
      .eq('modulename', moduleName)
      .order('id')
  );
}

// ── A3: releaseLocksAndSignOut ─────────────────────────────────────────────────
// Single definition — previously duplicated in queries.ts + queries.mobilenav.ts
export async function releaseLocksAndSignOut(
  userId: string,
  signOut: () => Promise<void>
): Promise<void> {
  await supabase.from('testlocks').delete().eq('userid', userId);
  await signOut();
}

// ── Phase 1 (unchanged): fetchModulesForSidebar ───────────────────────────────
export async function fetchModulesForSidebar(): Promise<Module[]> {
  return q<Module>(
    supabase.from('modules').select('name, description').order('name')
  );
}
