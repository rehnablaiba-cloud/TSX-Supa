// src/lib/supabase/queries.testexecution.ts
import { supabase } from '../../supabase';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RawStepResult {
  id:           string;
  status:       'pass' | 'fail' | 'pending';
  remarks:      string;
  display_name: string;
  step: {
    id:                string;
    serial_no:          number;
    action:            string;
    expected_result:    string;
    is_divider:         boolean;
    action_image_urls:   string[];
    expected_image_urls: string[];
  } | null;
}

export interface RawModuleTestItem {
  id:       string;
  testsname: string;
  test:     { serial_no: string; name: string } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchTestExecution
// Returns step results for the current module test + all module tests (for nav)
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchTestExecution(module_test_id: string): Promise<{
  step_results:  RawStepResult[];
  module_tests:  RawModuleTestItem[];
}> {
  // Fetch the module name first so we can scope the module_tests query
  const { data: mtData, error: mtErr } = await supabase
    .from('module_tests')
    .select('module_name')
    .eq('id', module_test_id)
    .single();

  if (mtErr) throw mtErr;

  const module_name = (mtData as any)?.module_name ?? '';

  const [srRes, allMtRes] = await Promise.all([
    supabase
      .from('step_results')
      .select(`
        id, status, remarks, display_name,
        step:test_steps!test_stepsid(
          id, serial_no, action, expected_result, is_divider,
          action_image_urls, expected_image_urls
        )
      `)
      .eq('module_test_id', module_test_id)
      .order('id'),
    supabase
      .from('module_tests')
      .select('id, testsname, test:tests!testsname(serial_no, name)')
      .eq('module_name', module_name)
      .order('testsname'),
  ]);

  if (srRes.error)    throw srRes.error;
  if (allMtRes.error) throw allMtRes.error;

  return {
    step_results: (srRes.data    ?? []) as unknown as RawStepResult[],
    module_tests: (allMtRes.data ?? []) as unknown as RawModuleTestItem[],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lock management
// ─────────────────────────────────────────────────────────────────────────────

export async function acquireLock(
  module_test_id: string,
  user_id:       string,
  display_name:  string
): Promise<{ success: boolean; holder?: string }> {
  // Check if already locked by someone else
  const { data: existing } = await supabase
    .from('test_locks')
    .select('user_id, locked_by_name')
    .eq('module_test_id', module_test_id)
    .maybeSingle();

  if (existing && (existing as any).user_id !== user_id) {
    return { success: false, holder: (existing as any).locked_by_name };
  }

  const { error } = await supabase
    .from('test_locks')
    .upsert(
      {
        module_test_id: module_test_id,
        user_id:       user_id,
        locked_by_name: display_name,
        locked_at:     new Date().toISOString(),
      },
      { onConflict: 'module_test_id' }
    );

  if (error) throw error;
  return { success: true };
}

export async function releaseLock(module_test_id: string, user_id: string): Promise<void> {
  await supabase
    .from('test_locks')
    .delete()
    .eq('module_test_id', module_test_id)
    .eq('user_id', user_id);
}

export async function forceReleaseLock(module_test_id: string): Promise<void> {
  await supabase
    .from('test_locks')
    .delete()
    .eq('module_test_id', module_test_id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step results
// ─────────────────────────────────────────────────────────────────────────────

export async function upsertStepResult(payload: {
  test_stepsid:  string;
  module_test_id: string;
  status:       'pass' | 'fail' | 'pending';
  remarks:      string;
  display_name: string;
  user_id:      string;
}): Promise<void> {
  const { error } = await supabase
    .from('step_results')
    .upsert(payload, { onConflict: 'test_stepsid,module_test_id' });
  if (error) throw error;
}

export async function resetAllstep_results(module_test_id: string): Promise<void> {
  const { error } = await supabase
    .from('step_results')
    .update({ status: 'pending', remarks: '' })
    .eq('module_test_id', module_test_id);
  if (error) throw error;
}

// ─────────────────────────────────────────────────────────────────────────────
// Signed image URLs
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchSignedUrls(paths: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (!unique.length) return {};

  const result: Record<string, string> = {};
  await Promise.all(
    unique.map(async path => {
      const { data } = await supabase.storage
        .from('test_steps')
        .createSignedUrl(path, 3600);
      if (data?.signedUrl) result[path] = data.signedUrl;
    })
  );
  return result;
}