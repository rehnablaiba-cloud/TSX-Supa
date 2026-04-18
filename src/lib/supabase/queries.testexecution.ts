// src/lib/supabase/queries.testexecution.ts
import { supabase } from '../../supabase';

export interface FlatData {
  module:   string;
  test:     string;
  serial:   number;
  serialno: number;
  action:   string;
  expected: string;
  expected_result: string;
  status:   'pass' | 'fail' | 'pending';
  remarks:  string;
  display_name: string;
}

export async function fetchTestExecution(moduleTestId: string) {
  const { data, error } = await supabase
    .from('teststeps')
    .select(`
      id, serialno, action, expectedresult, isdivider,
      stepresults(id, status, remarks, display_name, updated_at)
    `)
    .eq('moduletestid', moduleTestId)
    .order('serialno');
  if (error) throw error;
  return data ?? [];
}

export async function acquireLock(
  moduleTestId: string, userId: string, displayName: string
): Promise<{ success: boolean; holder?: string }> {
  const { data, error } = await supabase.rpc('acquire_test_lock', {
    p_moduletestid: moduleTestId,
    p_userid: userId,
    p_display_name: displayName,
  });
  if (error) throw error;
  return data as { success: boolean; holder?: string };
}

export async function releaseLock(moduleTestId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('testlocks').delete()
    .eq('moduletestid', moduleTestId).eq('userid', userId);
  if (error) throw error;
}

export async function forceReleaseLock(moduleTestId: string): Promise<void> {
  const { error } = await supabase
    .from('testlocks').delete().eq('moduletestid', moduleTestId);
  if (error) throw error;
}

export async function upsertStepResult(payload: {
  teststepsid: string;
  moduletestid: string;
  status: 'pass' | 'fail' | 'pending';
  remarks: string;
  display_name: string;
  user_id: string;
}): Promise<void> {
  const { error } = await supabase.from('stepresults').upsert(
    payload, { onConflict: 'teststepsid' }
  );
  if (error) throw error;
}

export async function resetAllStepResults(moduleTestId: string): Promise<void> {
  const { error } = await supabase
    .from('stepresults').delete().eq('moduletestid', moduleTestId);
  if (error) throw error;
}

export async function fetchSignedUrls(paths: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const path of paths) {
    const { data } = await supabase.storage
      .from('step-images').createSignedUrl(path, 3600);
    if (data?.signedUrl) result[path] = data.signedUrl;
  }
  return result;
}
