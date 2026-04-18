/**
 * queries.moduledashboard.ts
 * All supabase data calls extracted from ModuleDashboard.tsx
 * Add / merge these exports into your existing queries.ts
 */

import supabase from "../../supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RawModuleTest {
  id: string;
  testsname: string;
  test: { serialno: number; name: string; description?: string } | null;
}

export interface RawStepResult {
  id: string;
  modulename: string;
  teststepsid: string;
  status: string;
  remarks: string;
  displayname: string;
}

export interface RawLock {
  moduletestid: string;
  userid: string;
  lockedbyname: string;
}

export interface RawTest {
  name: string;
  serialno: string;
}

export interface RawStep {
  id: string;
  serialno: number;
  action: string;
  expectedresult: string;
  actionimageurls: string[];
  expectedimageurls: string[];
  isdivider: boolean;
  testsname: string;
}

export interface ModuleDashboardData {
  moduleTests: RawModuleTest[];
  stepResults: RawStepResult[];
  locks: RawLock[];
  tests: Record<string, RawTest>;
  steps: Record<string, RawStep>;
}

// ─── fetchModuleDashboard ─────────────────────────────────────────────────────
/**
 * Single entry-point that fetches all data needed to render ModuleDashboard
 * for a given module + specific moduleTestId (currentMtId).
 *
 * Replaces the three parallel supabase calls inside load() and two
 * subsequent RPC calls (gettestsbynames, getteststepsbyids).
 */
export async function fetchModuleDashboard(
  moduleName: string,
  currentMtId: string
): Promise<ModuleDashboardData> {
  const [mtRes, srRes, locksRes] = await Promise.all([
    supabase
      .from("moduletests")
      .select("id, testsname, test:tests!testsname(serialno, name, description)")
      .eq("modulename", moduleName)
      .order("id"),
    supabase
      .rpc("getstepresultsformodule", { p_modulename: moduleName }),
    supabase
      .from("testlocks")
      .select("moduletestid, userid, lockedbyname"),
  ]);

  if (mtRes.error)    throw new Error(mtRes.error.message);
  if (srRes.error)    throw new Error(srRes.error.message);

  const rawMts   = (mtRes.data ?? [])  as RawModuleTest[];
  const rawSrs   = (srRes.data ?? [])  as RawStepResult[];

  // Resolve test names via RPC
  const testNames = Array.from(new Set(rawMts.map(m => m.testsname)));
  const testsMap: Record<string, RawTest> = {};
  if (testNames.length > 0) {
    const testsRes = await supabase.rpc("gettestsbynames", { p_names: testNames });
    ((testsRes.data ?? []) as (RawTest & { name: string })[]).forEach(t => {
      testsMap[t.name] = t;
    });
  }

  // Resolve step details via RPC
  const stepIds = rawSrs.map(sr => sr.teststepsid);
  const stepsMap: Record<string, RawStep> = {};
  if (stepIds.length > 0) {
    const stepsRes = await supabase.rpc("getteststepsbyids", { p_ids: stepIds });
    ((stepsRes.data ?? []) as RawStep[]).forEach(s => {
      stepsMap[s.id] = s;
    });
  }

  return {
    moduleTests: rawMts,
    stepResults: rawSrs,
    locks:       (locksRes.data ?? []) as RawLock[],
    tests:       testsMap,
    steps:       stepsMap,
  };
}

// ─── fetchModuleLocks ─────────────────────────────────────────────────────────
/**
 * Lightweight re-fetch of just the locks table.
 * Used by the debounced refetchLocks callback (realtime channel trigger).
 */
export async function fetchModuleLocks(): Promise<RawLock[]> {
  const { data, error } = await supabase
    .from("testlocks")
    .select("moduletestid, userid, lockedbyname");
  if (error) throw new Error(error.message);
  return (data ?? []) as RawLock[];
}

// ─── acquireModuleLock ────────────────────────────────────────────────────────
/**
 * Upsert a lock row for the given moduleTestId + userId.
 * Returns true if this user now owns the lock, false if it's held by someone else.
 */
export async function acquireModuleLock(
  moduleTestId: string,
  userId: string,
  displayName: string
): Promise<boolean> {
  const { error: upsertErr } = await supabase
    .from("testlocks")
    .upsert(
      {
        moduletestid: moduleTestId,
        userid:       userId,
        lockedbyname: displayName,
        lockedat:     new Date().toISOString(),
      },
      { onConflict: "moduletestid", ignoreDuplicates: true }
    );
  if (upsertErr) throw new Error(upsertErr.message);

  const { data: owned } = await supabase
    .from("testlocks")
    .select("userid")
    .eq("moduletestid", moduleTestId)
    .single();

  return owned?.userid === userId;
}

// ─── releaseModuleLock ────────────────────────────────────────────────────────
export async function releaseModuleLock(
  moduleTestId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from("testlocks")
    .delete()
    .eq("moduletestid", moduleTestId)
    .eq("userid", userId);
  if (error) throw new Error(error.message);
}

// ─── forceReleaseModuleLock ───────────────────────────────────────────────────
export async function forceReleaseModuleLock(moduleTestId: string): Promise<void> {
  const { error } = await supabase
    .from("testlocks")
    .delete()
    .eq("moduletestid", moduleTestId);
  if (error) throw new Error(error.message);
}

// ─── heartbeatModuleLock ──────────────────────────────────────────────────────
export async function heartbeatModuleLock(
  moduleTestId: string,
  userId: string
): Promise<void> {
  await supabase
    .from("testlocks")
    .update({ lockedat: new Date().toISOString() })
    .eq("moduletestid", moduleTestId)
    .eq("userid", userId);
}

// ─── updateModuleStepResult ───────────────────────────────────────────────────
export async function updateModuleStepResult(params: {
  moduleName:   string;
  stepId:       string;
  status:       "pass" | "fail" | "pending";
  remarks:      string;
  displayName:  string;
}): Promise<void> {
  const { error } = await supabase.rpc("updatestepresult", {
    p_modulename:   params.moduleName,
    p_teststepsid:  params.stepId,
    p_status:       params.status,
    p_remarks:      params.remarks,
    p_displayname:  params.displayName,
  });
  if (error) throw error;
}

// ─── resetAllModuleStepResults ────────────────────────────────────────────────
export async function resetAllModuleStepResults(params: {
  moduleName:  string;
  steps:       { stepId: string }[];
  displayName: string;
}): Promise<void> {
  const results = await Promise.all(
    params.steps.map(s =>
      supabase.rpc("updatestepresult", {
        p_modulename:   params.moduleName,
        p_teststepsid:  s.stepId,
        p_status:       "pending",
        p_remarks:      "",
        p_displayname:  params.displayName,
      })
    )
  );
  const failed = results.find(r => r.error);
  if (failed) throw failed.error;
}

// ─── fetchExportStepData ──────────────────────────────────────────────────────
/**
 * Used by the ExportModal inside ModuleDashboard to build FlatData for CSV/PDF.
 * Replaces the two inline supabase calls in fetchAndExport().
 */
export async function fetchExportStepData(moduleName: string): Promise<{
  steps:   { id: string; serialno: number; action: string; expectedresult: string; isdivider: boolean; testsname: string }[];
  results: { teststepsid: string; status: string; remarks: string }[];
}> {
  const [stepsRes, resultsRes] = await Promise.all([
    supabase
      .from("teststeps")
      .select("id, serialno, action, expectedresult, isdivider, testsname")
      .eq("modulename", moduleName)
      .order("serialno"),
    supabase
      .from("stepresults")
      .select("teststepsid, status, remarks")
      .eq("modulename", moduleName),
  ]);

  if (stepsRes.error)   throw new Error(stepsRes.error.message);
  if (resultsRes.error) throw new Error(resultsRes.error.message);

  return {
    steps:   stepsRes.data   ?? [],
    results: resultsRes.data ?? [],
  };
}

// ─── fetchModuleSignedUrls ────────────────────────────────────────────────────
/**
 * Batch-sign storage paths from the "teststeps" bucket.
 * Identical to fetchSignedUrls in queries.ts but namespaced clearly.
 * You may de-duplicate by pointing this to the same shared helper.
 */
export async function fetchModuleSignedUrls(
  paths: string[]
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (!unique.length) return {};

  const results = await Promise.all(
    unique.map(async path => {
      const { data, error } = await supabase.storage
        .from("teststeps")
        .createSignedUrl(path, 60 * 60);
      if (error || !data?.signedUrl) return [path, ""] as const;
      return [path, data.signedUrl] as const;
    })
  );
  return Object.fromEntries(results.filter(([, url]) => !!url));
}
