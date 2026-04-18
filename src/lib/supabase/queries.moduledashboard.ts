/**
 * queries.moduledashboard.ts
 * All supabase data calls extracted from ModuleDashboard.tsx
 */

import {supabase} from "../../supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RawModuleTest {
  id: string;
  testsname: string;
  test: { serial_no: number; name: string; description?: string } | null;
}

export interface RawStepResultMD {
  id: string;
  module_name: string;
  test_stepsid: string;
  status: string;
  remarks: string;
  display_name: string;
}

export interface RawLock {
  module_test_id: string;
  user_id: string;
  locked_by_name: string;
}

export interface RawTest {
  name: string;
  serial_no: string;
}

export interface RawStep {
  id: string;
  serial_no: number;
  action: string;
  expected_result: string;
  action_image_urls: string[];
  expected_image_urls: string[];
  is_divider: boolean;
  testsname: string;
}

export interface ModuleDashboardData {
  module_tests: RawModuleTest[];
  step_results: RawStepResultMD[];
  locks: RawLock[];
  tests: Record<string, RawTest>;
  steps: Record<string, RawStep>;
}

// ─── fetchModuleDashboard ─────────────────────────────────────────────────────
export async function fetchModuleDashboard(
  module_name: string,
  currentMtId: string
): Promise<ModuleDashboardData> {
  const [mtRes, srRes, locksRes] = await Promise.all([
    supabase
      .from("module_tests")
      .select("id, testsname, test:tests!testsname(serial_no, name, description)")
      .eq("module_name", module_name)
      .order("id"),
    supabase
      .rpc("getstep_resultsformodule", { p_module_name: module_name }),
    supabase
      .from("test_locks")
      .select("module_test_id, user_id, locked_by_name"),
  ]);

  if (mtRes.error)    throw new Error(mtRes.error.message);
  if (srRes.error)    throw new Error(srRes.error.message);

  const rawMts   = (mtRes.data ?? []) as unknown as RawModuleTest[];
  const rawSrs   = (srRes.data ?? []) as RawStepResultMD[];

  const test_names = Array.from(new Set(rawMts.map(m => m.testsname)));
  const testsMap: Record<string, RawTest> = {};
  if (test_names.length > 0) {
    const testsRes = await supabase.rpc("gettestsbynames", { p_names: test_names });
    ((testsRes.data ?? []) as (RawTest & { name: string })[]).forEach(t => {
      testsMap[t.name] = t;
    });
  }

  const stepIds = rawSrs.map(sr => sr.test_stepsid);
  const stepsMap: Record<string, RawStep> = {};
  if (stepIds.length > 0) {
    const stepsRes = await supabase.rpc("gettest_stepsbyids", { p_ids: stepIds });
    ((stepsRes.data ?? []) as RawStep[]).forEach(s => {
      stepsMap[s.id] = s;
    });
  }

  return {
    module_tests: rawMts,
    step_results: rawSrs,
    locks:       (locksRes.data ?? []) as RawLock[],
    tests:       testsMap,
    steps:       stepsMap,
  };
}

// ─── fetchModuleLocks ─────────────────────────────────────────────────────────
export async function fetchModuleLocks(): Promise<RawLock[]> {
  const { data, error } = await supabase
    .from("test_locks")
    .select("module_test_id, user_id, locked_by_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as RawLock[];
}

// ─── acquireModuleLock ────────────────────────────────────────────────────────
export async function acquireModuleLock(
  module_test_id: string,
  user_id: string,
  display_name: string
): Promise<boolean> {
  const { error: upsertErr } = await supabase
    .from("test_locks")
    .upsert(
      {
        module_test_id: module_test_id,
        user_id:       user_id,
        locked_by_name: display_name,
        locked_at:     new Date().toISOString(),
      },
      { onConflict: "module_test_id", ignoreDuplicates: true }
    );
  if (upsertErr) throw new Error(upsertErr.message);

  const { data: owned } = await supabase
    .from("test_locks")
    .select("user_id")
    .eq("module_test_id", module_test_id)
    .single();

  return (owned as any)?.user_id === user_id;
}

// ─── releaseModuleLock ────────────────────────────────────────────────────────
export async function releaseModuleLock(
  module_test_id: string,
  user_id: string
): Promise<void> {
  const { error } = await supabase
    .from("test_locks")
    .delete()
    .eq("module_test_id", module_test_id)
    .eq("user_id", user_id);
  if (error) throw new Error(error.message);
}

// ─── forceReleaseModuleLock ───────────────────────────────────────────────────
export async function forceReleaseModuleLock(module_test_id: string): Promise<void> {
  const { error } = await supabase
    .from("test_locks")
    .delete()
    .eq("module_test_id", module_test_id);
  if (error) throw new Error(error.message);
}

// ─── heartbeatModuleLock ──────────────────────────────────────────────────────
export async function heartbeatModuleLock(
  module_test_id: string,
  user_id: string
): Promise<void> {
  await supabase
    .from("test_locks")
    .update({ locked_at: new Date().toISOString() })
    .eq("module_test_id", module_test_id)
    .eq("user_id", user_id);
}

// ─── updateModuleStepResult ───────────────────────────────────────────────────
export async function updateModuleStepResult(params: {
  module_name:   string;
  stepId:       string;
  status:       "pass" | "fail" | "pending";
  remarks:      string;
  display_name:  string;
}): Promise<void> {
  const { error } = await supabase.rpc("updatestepresult", {
    p_module_name:   params.module_name,
    p_test_stepsid:  params.stepId,
    p_status:       params.status,
    p_remarks:      params.remarks,
    p_display_name:  params.display_name,
  });
  if (error) throw error;
}

// ─── resetAllModulestep_results ────────────────────────────────────────────────
export async function resetAllModulestep_results(params: {
  module_name:  string;
  steps:       { stepId: string }[];
  display_name: string;
}): Promise<void> {
  const results = await Promise.all(
    params.steps.map(s =>
      supabase.rpc("updatestepresult", {
        p_module_name:   params.module_name,
        p_test_stepsid:  s.stepId,
        p_status:       "pending",
        p_remarks:      "",
        p_display_name:  params.display_name,
      })
    )
  );
  const failed = results.find(r => r.error);
  if (failed) throw failed.error;
}

// ─── fetchExportStepData ──────────────────────────────────────────────────────
export async function fetchExportStepData(module_name: string): Promise<{
  steps:   { id: string; serial_no: number; action: string; expected_result: string; is_divider: boolean; testsname: string }[];
  results: { test_stepsid: string; status: string; remarks: string }[];
}> {
  const [stepsRes, resultsRes] = await Promise.all([
    supabase
      .from("test_steps")
      .select("id, serial_no, action, expected_result, is_divider, testsname")
      .eq("module_name", module_name)
      .order("serial_no"),
    supabase
      .from("step_results")
      .select("test_stepsid, status, remarks")
      .eq("module_name", module_name),
  ]);

  if (stepsRes.error)   throw new Error(stepsRes.error.message);
  if (resultsRes.error) throw new Error(resultsRes.error.message);

  return {
    steps:   stepsRes.data   ?? [],
    results: resultsRes.data ?? [],
  };
}

// ─── fetchModuleSignedUrls ────────────────────────────────────────────────────
export async function fetchModuleSignedUrls(
  paths: string[]
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (!unique.length) return {};

  const results = await Promise.all(
    unique.map(async path => {
      const { data, error } = await supabase.storage
        .from("test_steps")
        .createSignedUrl(path, 60 * 60);
      if (error || !data?.signedUrl) return [path, ""] as const;
      return [path, data.signedUrl] as const;
    })
  );
  return Object.fromEntries(results.filter(([, url]) => !!url));
}