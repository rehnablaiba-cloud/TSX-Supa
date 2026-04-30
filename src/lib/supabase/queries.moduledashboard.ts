/**
 * queries.moduledashboard.ts
 *
 * Revision-aware update (2025):
 *  - fetchModuleDashboard now fetches the active revision for every test in the
 *    module and exposes it via `revisions` (keyed by tests_serial_no).
 *  - step_results from the RPC are already scoped to module_name; an additional
 *    JS-side filter narrows them to rows whose revision_id matches the active
 *    revision for each test, with a null-fallback for legacy data.
 */

import { supabase } from "../../supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RawModuleTest {
  id: string;
  tests_name: string;
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
  tests_serial_no: string;
}

/** Active revision metadata surfaced to the dashboard per test. */
export interface DashboardRevision {
  id: string;
  revision: string;
  is_visible: boolean;
}

export interface ModuleDashboardData {
  module_tests: RawModuleTest[];
  step_results: RawStepResultMD[];
  locks: RawLock[];
  tests: Record<string, RawTest>;
  steps: Record<string, RawStep>;
  /**
   * Active revision per test, keyed by tests_serial_no.
   * Present only for tests that have an activated revision.
   */
  revisions: Record<string, DashboardRevision>;
}

// ─── fetchModuleDashboard ─────────────────────────────────────────────────────

export async function fetchModuleDashboard(
  module_name: string,
  currentMtId: string
): Promise<ModuleDashboardData> {
  const [mtRes, srRes, locksRes] = await Promise.all([
    supabase
      .from("module_tests")
      .select(
        "id, tests_name, test:tests!module_tests_tests_name_fkey(serial_no, name, description)"
      )
      .eq("module_name", module_name)
      .order("id"),
    supabase.rpc("getstep_resultsformodule", { p_module_name: module_name }),
    supabase
      .from("test_locks")
      .select("module_test_id, user_id, locked_by_name"),
  ]);

  if (mtRes.error) throw new Error(mtRes.error.message);
  if (srRes.error) throw new Error(srRes.error.message);

  const rawMts = (mtRes.data ?? []) as unknown as RawModuleTest[];
  const rawSrs = (srRes.data ?? []) as RawStepResultMD[];

  // ── Collect test names + serial_nos ────────────────────────────────────────
  const test_names = Array.from(new Set(rawMts.map((m) => m.tests_name)));

  const testsMap: Record<string, RawTest> = {};
  if (test_names.length > 0) {
    const testsRes = await supabase.rpc("gettestsbynames", {
      p_names: test_names,
    });
    ((testsRes.data ?? []) as (RawTest & { name: string })[]).forEach((t) => {
      testsMap[t.name] = t;
    });
  }

  // ── Fetch active revisions for all tests in this module ────────────────────
  const serialNos: string[] = rawMts
    .map((mt) => (mt.test as any)?.serial_no as string | undefined)
    .filter((s): s is string => !!s);

  const revisionsMap: Record<string, DashboardRevision> = {};

  if (serialNos.length > 0) {
    const { data: revData, error: revErr } = await supabase
      .from("test_revisions")
      .select("id, revision, is_visible, tests_serial_no")
      .eq("status", "active")
      .in("tests_serial_no", serialNos);

    if (revErr) throw new Error(revErr.message);

    ((revData ?? []) as any[]).forEach((r) => {
      revisionsMap[r.tests_serial_no] = {
        id: r.id,
        revision: r.revision,
        is_visible: r.is_visible,
      };
    });
  }

  // ── Fetch steps for the step_results returned by RPC ──────────────────────
  const stepIds = rawSrs.map((sr) => sr.test_stepsid);
  const stepsMap: Record<string, RawStep> = {};

  if (stepIds.length > 0) {
    const stepsRes = await supabase.rpc("gettest_stepsbyids", {
      p_ids: stepIds,
    });
    ((stepsRes.data ?? []) as RawStep[]).forEach((s) => {
      stepsMap[s.id] = s;
    });
  }

  // ── JS-side revision filter on step_results ────────────────────────────────
  //
  // The RPC returns ALL step_results for the module (no revision filter in SQL).
  // We narrow the results here:
  //  • If a step's parent test has an active revision → keep only results whose
  //    step belongs to that revision's step_order.
  //  • If no active revision for the test → keep results whose step does not
  //    belong to any revision (legacy path, revision_id implicitly null).
  //
  // Build a set of step IDs that are "in scope" for each serial_no.
  // For this we need the step_order from the active revision.

  const inScopeStepIds = new Set<string>();
  const testsWithoutRevision = new Set<string>(serialNos);

  if (Object.keys(revisionsMap).length > 0) {
    const revIds = Object.values(revisionsMap).map((r) => r.id);
    const { data: revDetailData } = await supabase
      .from("test_revisions")
      .select("id, tests_serial_no, step_order")
      .in("id", revIds);

    ((revDetailData ?? []) as any[]).forEach((r) => {
      const steps: string[] = Array.isArray(r.step_order) ? r.step_order : [];
      steps.forEach((sid) => inScopeStepIds.add(sid));
      testsWithoutRevision.delete(r.tests_serial_no);
    });
  }

  // Build set of serial_nos that have no active revision (for fallback)
  // Steps belonging to those tests remain unfiltered.
  const filteredSrs = rawSrs.filter((sr) => {
    const step = stepsMap[sr.test_stepsid];
    if (!step) return false;

    const serialNo = step.tests_serial_no;

    if (testsWithoutRevision.has(serialNo)) {
      // Legacy path: no active revision → show all
      return true;
    }
    // Revision path: only show steps in scope
    return inScopeStepIds.has(sr.test_stepsid);
  });

  return {
    module_tests: rawMts,
    step_results: filteredSrs,
    locks: (locksRes.data ?? []) as RawLock[],
    tests: testsMap,
    steps: stepsMap,
    revisions: revisionsMap,
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
        user_id: user_id,
        locked_by_name: display_name,
        locked_at: new Date().toISOString(),
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

export async function forceReleaseModuleLock(
  module_test_id: string
): Promise<void> {
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
  module_name: string;
  stepId: string;
  status: "pass" | "fail" | "pending";
  remarks: string;
  display_name: string;
}): Promise<void> {
  const { error } = await supabase.rpc("updatestepresult", {
    p_module_name: params.module_name,
    p_test_stepsid: params.stepId,
    p_status: params.status,
    p_remarks: params.remarks,
    p_display_name: params.display_name,
  });
  if (error) throw error;
}

// ─── resetAllModulestep_results ────────────────────────────────────────────────

export async function resetAllModulestep_results(params: {
  module_name: string;
  steps: { stepId: string }[];
  display_name: string;
}): Promise<void> {
  const results = await Promise.all(
    params.steps.map((s) =>
      supabase.rpc("updatestepresult", {
        p_module_name: params.module_name,
        p_test_stepsid: s.stepId,
        p_status: "pending",
        p_remarks: "",
        p_display_name: params.display_name,
      })
    )
  );
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
}

// ─── fetchExportStepData ──────────────────────────────────────────────────────

export async function fetchExportStepData(module_name: string): Promise<{
  steps: {
    id: string;
    serial_no: number;
    action: string;
    expected_result: string;
    is_divider: boolean;
    tests_serial_no: string;
  }[];
  results: { test_stepsid: string; status: string; remarks: string }[];
}> {
  const resultsRes = await supabase
    .from("step_results")
    .select("test_steps_id, status, remarks")
    .eq("module_name", module_name);

  if (resultsRes.error) throw new Error(resultsRes.error.message);

  const stepIds = (resultsRes.data ?? []).map((r: any) => r.test_steps_id);

  const stepsRes =
    stepIds.length > 0
      ? await supabase
          .from("test_steps")
          .select(
            "id, serial_no, action, expected_result, is_divider, tests_serial_no"
          )
          .in("id", stepIds)
          .order("serial_no")
      : { data: [], error: null };

  if (stepsRes.error) throw new Error(stepsRes.error.message);

  return {
    steps: stepsRes.data ?? [],
    results: (resultsRes.data ?? []).map((r: any) => ({
      test_stepsid: r.test_steps_id,
      status: r.status,
      remarks: r.remarks,
    })),
  };
}

// ─── fetchModuleSignedUrls ────────────────────────────────────────────────────

export async function fetchModuleSignedUrls(
  paths: string[]
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (!unique.length) return {};

  const results = await Promise.all(
    unique.map(async (path) => {
      const { data, error } = await supabase.storage
        .from("test_steps")
        .createSignedUrl(path, 60 * 60);
      if (error || !data?.signedUrl) return [path, ""] as const;
      return [path, data.signedUrl] as const;
    })
  );
  return Object.fromEntries(results.filter(([, url]) => !!url));
}
