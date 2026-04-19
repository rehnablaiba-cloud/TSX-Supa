// src/lib/supabase/queries.testreport.ts
// Imported directly by: TestReport.tsx

import { supabase } from '../../supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReportMeta {
  module_name: string;
  tests_name:  string;
  test: { serial_no: number; name: string; description?: string } | null;
}

export interface ReportStepResult {
  id:           string;
  status:       'pass' | 'fail' | 'pending';
  remarks:      string;
  display_name: string;
  step: {
    id:              string;
    serial_no:       number;
    action:          string;
    expected_result: string;
    is_divider:      boolean;
    tests_name:      string;
  } | null;
}

export interface TestReportData {
  meta:    ReportMeta;
  results: ReportStepResult[];
}

// ── fetchTestReportData ───────────────────────────────────────────────────────

export async function fetchTestReportData(module_test_id: string): Promise<TestReportData> {
  const { data: metaData, error: metaErr } = await supabase
    .from('module_tests')
    .select('module_name, tests_name, test:tests!module_tests_tests_name_fkey(serial_no, name, description)')
    .eq('id', module_test_id)
    .single();
  if (metaErr) throw new Error(metaErr.message);
  const meta = metaData as unknown as ReportMeta;

  const { data: srData, error: srErr } = await supabase
    .from('step_results')
    .select(`
      id, status, remarks, display_name,
      step:test_steps!step_results_test_steps_id_fkey(
        id, serial_no, action, expected_result, is_divider, tests_name
      )
    `)
    .eq('module_name', meta.module_name)
    .order('id');
  if (srErr) throw new Error(srErr.message);

  return {
    meta,
    results: (srData ?? []) as unknown as ReportStepResult[],
  };
}

// ── fetchReportStepResults (realtime re-fetch) ────────────────────────────────

export async function fetchReportStepResults(module_name: string): Promise<ReportStepResult[]> {
  const { data, error } = await supabase
    .from('step_results')
    .select(`
      id, status, remarks, display_name,
      step:test_steps!step_results_test_steps_id_fkey(
        id, serial_no, action, expected_result, is_divider, tests_name
      )
    `)
    .eq('module_name', module_name)
    .order('id');
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ReportStepResult[];
}
