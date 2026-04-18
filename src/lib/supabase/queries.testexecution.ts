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
    serialno:          number;
    action:            string;
    expectedresult:    string;
    isdivider:         boolean;
    actionimageurls:   string[];
    expectedimageurls: string[];
  } | null;
}

export interface RawModuleTestItem {
  id:       string;
  testsname: string;
  test:     { serialno: string; name: string } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchTestExecution
// Returns step results for the current module test + all module tests (for nav)
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchTestExecution(moduleTestId: string): Promise<{
  stepResults:  RawStepResult[];
  moduleTests:  RawModuleTestItem[];
}> {
  // Fetch the module name first so we can scope the moduleTests query
  const { data: mtData, error: mtErr } = await supabase
    .from('moduletests')
    .select('modulename')
    .eq('id', moduleTestId)
    .single();

  if (mtErr) throw mtErr;

  const moduleName = (mtData as any)?.modulename ?? '';

  const [srRes, allMtRes] = await Promise.all([
    supabase
      .from('stepresults')
      .select(`
        id, status, remarks, display_name,
        step:teststeps!teststepsid(
          id, serialno, action, expectedresult, isdivider,
          actionimageurls, expectedimageurls
        )
      `)
      .eq('moduletestid', moduleTestId)
      .order('id'),
    supabase
      .from('moduletests')
      .select('id, testsname, test:tests!testsname(serialno, name)')
      .eq('modulename', moduleName)
      .order('testsname'),
  ]);

  if (srRes.error)    throw srRes.error;
  if (allMtRes.error) throw allMtRes.error;

  return {
    stepResults: (srRes.data    ?? []) as unknown as RawStepResult[],
    moduleTests: (allMtRes.data ?? []) as unknown as RawModuleTestItem[],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lock management
// ─────────────────────────────────────────────────────────────────────────────

export async function acquireLock(
  moduleTestId: string,
  userId:       string,
  displayName:  string
): Promise<{ success: boolean; holder?: string }> {
  // Check if already locked by someone else
  const { data: existing } = await supabase
    .from('testlocks')
    .select('userid, lockedbyname')
    .eq('moduletestid', moduleTestId)
    .maybeSingle();

  if (existing && (existing as any).userid !== userId) {
    return { success: false, holder: (existing as any).lockedbyname };
  }

  const { error } = await supabase
    .from('testlocks')
    .upsert(
      {
        moduletestid: moduleTestId,
        userid:       userId,
        lockedbyname: displayName,
        lockedat:     new Date().toISOString(),
      },
      { onConflict: 'moduletestid' }
    );

  if (error) throw error;
  return { success: true };
}

export async function releaseLock(moduleTestId: string, userId: string): Promise<void> {
  await supabase
    .from('testlocks')
    .delete()
    .eq('moduletestid', moduleTestId)
    .eq('userid', userId);
}

export async function forceReleaseLock(moduleTestId: string): Promise<void> {
  await supabase
    .from('testlocks')
    .delete()
    .eq('moduletestid', moduleTestId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step results
// ─────────────────────────────────────────────────────────────────────────────

export async function upsertStepResult(payload: {
  teststepsid:  string;
  moduletestid: string;
  status:       'pass' | 'fail' | 'pending';
  remarks:      string;
  display_name: string;
  user_id:      string;
}): Promise<void> {
  const { error } = await supabase
    .from('stepresults')
    .upsert(payload, { onConflict: 'teststepsid,moduletestid' });
  if (error) throw error;
}

export async function resetAllStepResults(moduleTestId: string): Promise<void> {
  const { error } = await supabase
    .from('stepresults')
    .update({ status: 'pending', remarks: '' })
    .eq('moduletestid', moduleTestId);
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