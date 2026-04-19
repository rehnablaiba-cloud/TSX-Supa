// src/lib/supabase/queries.moduledashboard.ts
// Imported directly by: ModuleDashboard.tsx

import { supabase } from '../../supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RawModuleTest {
  id:         string;
  tests_name: string;
  test: { serial_no: number; name: string; description?: string } | null;
}

export interface RawStepResultMD {
  id:           string;
  module_name:  string;
  test_steps_id: string;   // ✅ was test_stepsid
  status:       string;
  remarks:      string;
  display_name: string;
}

export interface RawLock {
  module_test_id: string;
  user_id:        string;
  locked_by_name: string;
}

export interface RawTest {
  name:      string;
  serial_no: string;
}

export interface RawStep {
  id:                  string;
  serial_no:           number;
  action:              string;
  expected_result:     string;
  action_image_urls:   string[];
  expected_image_urls: string[];
  is_divider:          boolean;
  tests_name:          string;
}

export interface ModuleDashboardData {
  module_tests: RawModuleTest[];
  step_results: RawStepResultMD[];
  locks:        RawLock[];
  tests:        Record<string, RawTest>;
  steps:        Record<string, RawStep>;
}

// ── fetchModuleDashboard ──────────────────────────────────────────────────────

export async function fetchModuleDashboard(
  module_name: string
): Promise<ModuleDashboardData> {
  const [mtRes, srRes, locksRes] = await Promise.all([
    supabase
      .from('module_tests')
      .select('id, tests_name, test:tests!module_tests_tests_name_fkey(serial_no, name, description)')
      .eq('module_name', module_name)
      .order('id'),
    supabase
      .rpc('get_step_results_for_module', { p_module_name: module_name }), // ✅ was getstep_resultsformodule
    supabase
      .from('test_locks')
      .select('module_test_id, user_id, locked_by_name'),
  ]);
  if (mtRes.error) throw new Error(mtRes.error.message);
  if (srRes.error) throw new Error(srRes.error.message);

  const rawMts = (mtRes.data ?? []) as unknown as RawModuleTest[];
  const rawSrs = (srRes.data ?? []) as RawStepResultMD[];

  const test_names = Array.from(new Set(rawMts.map(m => m.tests_name)));
  const testsMap: Record<string, RawTest> = {};
  if (test_names.length > 0) {
    const testsRes = await supabase
      .rpc('get_tests_by_names', { p_names: test_names }); // ✅ was gettestsbynames
    ((testsRes.data ?? []) as (RawTest & { name: string })[]).forEach(t => {
      testsMap[t.name] = t;
    });
  }

  const stepIds = rawSrs.map(sr => sr.test_steps_id);   // ✅ was test_stepsid
  const stepsMap: Record<string, RawStep> = {};
  if (stepIds.length > 0) {
    const stepsRes = await supabase
      .rpc('get_test_steps_by_ids', { p_ids: stepIds }); // ✅ was gettest_stepsbyids
    ((stepsRes.data ?? []) as RawStep[]).forEach(s => {
      stepsMap[s.id] = s;
    });
  }

  return {
    module_tests: rawMts,
    step_results: rawSrs,
    locks:        (locksRes.data ?? []) as RawLock[],
    tests:        testsMap,
    steps:        stepsMap,
  };
}

// ── Lock management ───────────────────────────────────────────────────────────

export async function fetchModuleLocks(): Promise<RawLock[]> {
  const { data, error } = await supabase
    .from('test_locks')
    .select('module_test_id, user_id, locked_by_name');
  if (error) throw new Error(error.message);
  return (data ?? []) as RawLock[];
}

export async function acquireModuleLock(
  module_test_id: string,
  user_id:        string,
  display_name:   string
): Promise<boolean> {
  const { error: upsertErr } = await supabase
    .from('test_locks')
    .upsert(
      {
        module_test_id,
        user_id,
        locked_by_name: display_name,
        locked_at:      new Date().toISOString(),
      },
      { onConflict: 'module_test_id', ignoreDuplicates: true }
    );
  if (upsertErr) throw new Error(upsertErr.message);
  const { data: owned } = await supabase
    .from('test_locks')
    .select('user_id')
    .eq('module_test_id', module_test_id)
    .single();
  return (owned as any)?.user_id === user_id;
}

export async function releaseModuleLock(
  module_test_id: string,
  user_id:        string
): Promise<void> {
  const { error } = await supabase
    .from('test_locks')
    .delete()
    .eq('module_test_id', module_test_id)
    .eq('user_id', user_id);
  if (error) throw new Error(error.message);
}

export async function forceReleaseModuleLock(module_test_id: string): Promise<void> {
  const { error } = await supabase
    .from('test_locks')
    .delete()
    .eq('module_test_id', module_test_id);
  if (error) throw new Error(error.message);
}

export async function heartbeatModuleLock(
  module_test_id: string,
  user_id:        string
): Promise<void> {
  await supabase
    .from('test_locks')
    .update({ locked_at: new Date().toISOString() })
    .eq('module_test_id', module_test_id)
    .eq('user_id', user_id);
}

// ── Step result writes ────────────────────────────────────────────────────────

export async function updateModuleStepResult(params: {
  module_name:  string;
  stepId:       string;
  status:       'pass' | 'fail' | 'pending';
  remarks:      string;
  display_name: string;
}): Promise<void> {
  const { error } = await supabase.rpc('update_step_result', { // ✅ was updatestepresult
    p_module_name:   params.module_name,
    p_test_steps_id: params.stepId,                            // ✅ was p_test_stepsid
    p_status:        params.status,
    p_remarks:       params.remarks,
    p_display_name:  params.display_name,
  });
  if (error) throw error;
}

export async function resetAllModuleStepResults(params: {
  module_name:  string;
  steps:        { stepId: string }[];
  display_name: string;
}): Promise<void> {
  const results = await Promise.all(
    params.steps.map(s =>
      supabase.rpc('update_step_result', {                     // ✅ was updatestepresult
        p_module_name:   params.module_name,
        p_test_steps_id: s.stepId,                            // ✅ was p_test_stepsid
        p_status:        'pending',
        p_remarks:       '',
        p_display_name:  params.display_name,
      })
    )
  );
  const failed = results.find(r => r.error);
  if (failed) throw failed.error;
}

// ── Export data ───────────────────────────────────────────────────────────────

export interface ExportStep {
  id:              string;
  serial_no:       number;
  action:          string;
  expected_result: string;
  is_divider:      boolean;
  tests_name:      string;
}

export interface ExportStepResult {
  test_steps_id: string;   // ✅ was test_stepsid
  status:        string;
  remarks:       string;
}

export async function fetchExportStepData(module_name: string): Promise<{
  steps:   ExportStep[];
  results: ExportStepResult[];
}> {
  // test_steps has no module_name column — must resolve via module_tests first.
  const { data: mtData, error: mtErr } = await supabase
    .from('module_tests')
    .select('tests_name')
    .eq('module_name', module_name);
  if (mtErr) throw new Error(mtErr.message);

  const tests_names = (mtData ?? []).map((m: any) => m.tests_name as string);

  const [stepsRes, resultsRes] = await Promise.all([
    supabase
      .from('test_steps')
      .select('id, serial_no, action, expected_result, is_divider, tests_name')
      .in('tests_name', tests_names)   // ✅ was .eq('module_name') — column does not exist on test_steps
      .order('serial_no'),
    supabase
      .from('step_results')
      .select('test_steps_id, status, remarks')  // ✅ was test_stepsid
      .eq('module_name', module_name),
  ]);
  if (stepsRes.error)   throw new Error(stepsRes.error.message);
  if (resultsRes.error) throw new Error(resultsRes.error.message);

  return {
    steps:   (stepsRes.data   ?? []) as ExportStep[],
    results: (resultsRes.data ?? []) as ExportStepResult[],
  };
}

// ── Signed URLs ───────────────────────────────────────────────────────────────

export async function fetchModuleSignedUrls(paths: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (!unique.length) return {};
  const results = await Promise.all(
    unique.map(async path => {
      const { data, error } = await supabase.storage
        .from('test_steps')
        .createSignedUrl(path, 3600);
      if (error || !data?.signedUrl) return [path, ''] as const;
      return [path, data.signedUrl] as const;
    })
  );
  return Object.fromEntries(results.filter(([, url]) => !!url));
}
