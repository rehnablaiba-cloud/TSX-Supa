// src/lib/supabase/queries.ts
// Shared queries used across multiple sections of the app.
// No re-exports from feature files — each feature imports its own file directly.

import { supabase } from '../../supabase';
import type { ModuleOption } from '../../types';

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
// Used by Sidebar / auth flow — not owned by any single feature.

export async function releaseLocksAndSignOut(
  user_id: string,
  signOut: () => Promise<void>
): Promise<void> {
  try { await supabase.from('test_locks').delete().eq('user_id', user_id); }
  catch (err) { console.error('Failed to release locks on sign out', err); }
  await signOut();
}

// ── Module + Test options (Sidebar) ──────────────────────────────────────────
// Always-visible sidebar needs these regardless of which feature zone is active.

export async function fetchModuleOptions(): Promise<ModuleOption[]> {
  const { data, error } = await supabase
    .from('modules')
    .select('name')
    .order('name');
  if (error) throw error;
  return (data ?? []) as ModuleOption[];
}

export async function fetchTestsForModule(
  module_name: string
): Promise<{ id: string; tests_name: string }[]> {
  const { data, error } = await supabase
    .from('module_tests')
    .select('id, tests_name')
    .eq('module_name', module_name)
    .order('tests_name');
  if (error) throw error;
  return (data ?? []) as { id: string; tests_name: string }[];
}
