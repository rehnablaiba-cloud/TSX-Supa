/**
 * queries.dashboard.ts
 *
 * Revision-aware update (2025):
 *  - fetchDashboardModules now fetches active revisions for every test in every
 *    module, then pulls step_results scoped only to those revision IDs.
 *  - For tests that have no activated revision yet (legacy data) the fallback
 *    is step_results WHERE revision_id IS NULL — same behaviour as before the
 *    revision system existed.
 *  - Step counts (pass / fail / pending / total) are computed in JS using
 *    step_order from the active revision so that divider rows and out-of-scope
 *    steps are excluded correctly.
 */
import { supabase } from "../../supabase";
import type { ActiveLock } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DashboardRevision {
  id: string;
  revision: string;
  is_visible: boolean;
  /** Ordered list of test_steps.id that belong to this revision. */
  step_order: string[];
}

export interface DashboardModuleTest {
  id: string;
  tests_name: string;
  test: { name: string; serial_no: string | null } | null;
  /** Active revision for this specific test, null if not yet activated. */
  active_revision: DashboardRevision | null;
}

/**
 * A step_result row returned for the dashboard.
 * Includes enough data to compute progress (status, is_divider) and to
 * link back to its parent test (tests_serial_no).
 */
export interface DashboardStepResult {
  status: string;
  test_steps_id: string;
  /** Denormalised from the joined test_steps row. */
  is_divider: boolean;
  tests_serial_no: string;
}

export interface DashboardModule {
  name: string;
  description: string | null;
  module_tests: DashboardModuleTest[];
  /**
   * step_results already filtered to the active revision for each test.
   * Use step_order from the active_revision to sort/count correctly.
   */
  step_results: DashboardStepResult[];
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchDashboardModules
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchDashboardModules(): Promise<DashboardModule[]> {
  // ── 1. Fetch modules + module_tests (no step_results in this query) ────────
  const { data: modulesRaw, error: modErr } = await supabase
    .from("modules")
    .select(
      `
      name,
      description,
      module_tests:module_tests!module_name(
        id,
        tests_name,
        test:tests!module_tests_tests_name_fkey(name, serial_no)
      )
    `
    )
    .order("name");

  if (modErr) throw new Error(modErr.message);
  const modulesData = (modulesRaw ?? []) as any[];

  // ── 2. Collect every unique tests_serial_no across all modules ─────────────
  const allSerialNos: string[] = Array.from(
    new Set(
      modulesData.flatMap((mod) =>
        ((mod.module_tests ?? []) as any[])
          .map((mt: any) => mt.test?.serial_no as string | undefined)
          .filter((s): s is string => !!s)
      )
    )
  );

  if (allSerialNos.length === 0) {
    // No tests at all — return modules with empty step_results
    return modulesData.map((mod) => ({
      name: mod.name,
      description: mod.description ?? null,
      module_tests: (mod.module_tests ?? []).map((mt: any) => ({
        ...mt,
        active_revision: null,
      })),
      step_results: [],
    }));
  }

  // ── 3. Batch-fetch active revisions (including step_order) ─────────────────
  const { data: revRaw, error: revErr } = await supabase
    .from("test_revisions")
    .select("id, revision, is_visible, tests_serial_no, step_order")
    .eq("status", "active")
    .in("tests_serial_no", allSerialNos);

  if (revErr) throw new Error(revErr.message);

  /** Map: tests_serial_no → DashboardRevision */
  const revBySerial: Record<string, DashboardRevision> = {};
  ((revRaw ?? []) as any[]).forEach((r) => {
    revBySerial[r.tests_serial_no] = {
      id: r.id,
      revision: r.revision,
      is_visible: r.is_visible,
      step_order: Array.isArray(r.step_order) ? (r.step_order as string[]) : [],
    };
  });

  const activeRevisionIds = Object.values(revBySerial).map((r) => r.id);

  /** serial_nos that have NO active revision — legacy fallback path */
  const serialNosWithoutRevision = new Set(
    allSerialNos.filter((sn) => !revBySerial[sn])
  );

  // ── 4. Fetch step_results for the two paths ──────────────────────────────
  //
  // Path A — revised tests:
  //   step_results WHERE revision_id IN (activeRevisionIds)
  //   These rows were stamped with revision_id when the revision was activated.
  //
  // Path B — legacy / pre-revision tests:
  //   step_results WHERE revision_id IS NULL
  //   These belong to tests that have never had a revision activated. We
  //   further filter them in JS to only include steps whose tests_serial_no
  //   is in serialNosWithoutRevision.

  const srSelect = `
    status,
    test_steps_id,
    step:test_steps!step_results_test_steps_id_fkey(
      is_divider,
      tests_serial_no
    )
  `;
  
  const srPromises: Promise<any>[] = [];

  if (activeRevisionIds.length > 0) {
    srPromises.push(
      Promise.resolve(
        supabase
          .from("step_results")
          .select(srSelect)
          .in("revision_id", activeRevisionIds)
      )
    );
  }
  
  if (serialNosWithoutRevision.size > 0) {
    srPromises.push(
      Promise.resolve(
        supabase
          .from("step_results")
          .select(srSelect)
          .is("revision_id", null)
      )
    );
  }

  const srResponses = await Promise.all(srPromises);
  for (const res of srResponses) {
    if (res.error) throw new Error(res.error.message);
  }

  // Flatten + normalise into DashboardStepResult
  const allStepResults: DashboardStepResult[] = srResponses
    .flatMap((r) => (r.data ?? []) as any[])
    .map((row) => ({
      status: row.status as string,
      test_steps_id: row.test_steps_id as string,
      is_divider: (row.step?.is_divider ?? false) as boolean,
      tests_serial_no: (row.step?.tests_serial_no ?? "") as string,
    }))
    // Legacy filter: drop rows for tests that DO have an active revision
    // (those should only come through Path A)
    .filter(
      (sr) =>
        revBySerial[sr.tests_serial_no] !== undefined ||
        serialNosWithoutRevision.has(sr.tests_serial_no)
    );

  // ── 5. Build a lookup: test_steps_id → DashboardStepResult ─────────────────
  //
  // This lets the per-module assembly below work in O(1) per step.
  const srByStepId = new Map<string, DashboardStepResult>();
  for (const sr of allStepResults) {
    srByStepId.set(sr.test_steps_id, sr);
  }

  // ── 6. Assemble final DashboardModule array ──────────────────────────────
  return modulesData.map((mod): DashboardModule => {
    const enrichedMts: DashboardModuleTest[] = ((mod.module_tests ?? []) as any[]).map(
      (mt: any) => ({
        id: mt.id,
        tests_name: mt.tests_name,
        test: mt.test ?? null,
        active_revision: revBySerial[mt.test?.serial_no ?? ""] ?? null,
      })
    );

    // Collect step_results for this module only, ordered by step_order where
    // a revision exists, or by natural insertion order for legacy tests.
    const moduleStepResults: DashboardStepResult[] = [];

    for (const mt of enrichedMts) {
      const rev = mt.active_revision;

      if (rev && rev.step_order.length > 0) {
        // Revised path: walk step_order so counts respect ordering and scope
        for (const stepId of rev.step_order) {
          const sr = srByStepId.get(stepId);
          if (sr) moduleStepResults.push(sr);
        }
      } else {
        // Legacy path: all step_results whose tests_serial_no matches this test
        const serialNo = (mt.test?.serial_no ?? "") as string;
        for (const sr of allStepResults) {
          if (sr.tests_serial_no === serialNo) {
            moduleStepResults.push(sr);
          }
        }
      }
    }

    return {
      name: mod.name,
      description: mod.description ?? null,
      module_tests: enrichedMts,
      step_results: moduleStepResults,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchActiveLocks — current user's locks only (used for warning banner)
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchActiveLocks(): Promise<ActiveLock[]> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userEmail = sessionData?.session?.user?.email;
  if (!userEmail) return [];

  const { data: locks, error: lockErr } = await supabase
    .from("test_locks")
    .select("id, module_test_id, locked_by_name, locked_at")
    .eq("locked_by_name", userEmail);

  if (lockErr || !locks || locks.length === 0) return [];

  const module_test_ids = locks.map((l: any) => l.module_test_id);

  const { data: module_tests, error: mtErr } = await supabase
    .from("module_tests")
    .select("id, module_name, tests_name")
    .in("id", module_test_ids);

  if (mtErr || !module_tests) return [];

  const mtMap = Object.fromEntries(module_tests.map((mt: any) => [mt.id, mt]));

  return locks.map((l: any) => {
    const mt = mtMap[l.module_test_id];
    return {
      module_test_id: l.module_test_id,
      module_name: mt?.module_name ?? "Unknown Module",
      test_name: mt?.tests_name ?? "Unknown Test",
      locked_at: l.locked_at ?? "",
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchOtherActiveLockModules — locks held by OTHER users
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchOtherActiveLockModules(): Promise<
  Map<string, number>
> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userEmail = sessionData?.session?.user?.email;

  const { data: locks, error } = await supabase
    .from("test_locks")
    .select("module_test_id, locked_by_name");

  if (error || !locks || locks.length === 0) return new Map();

  const otherLocks = locks.filter((l: any) => l.locked_by_name !== userEmail);
  if (otherLocks.length === 0) return new Map();

  const module_test_ids = otherLocks.map((l: any) => l.module_test_id);

  const { data: module_tests, error: mtErr } = await supabase
    .from("module_tests")
    .select("id, module_name")
    .in("id", module_test_ids);

  if (mtErr || !module_tests) return new Map();

  const idToModule = Object.fromEntries(
    module_tests.map((mt: any) => [mt.id, mt.module_name])
  );

  const countMap = new Map<string, number>();
  for (const lock of otherLocks) {
    const moduleName = idToModule[lock.module_test_id];
    if (!moduleName) continue;
    countMap.set(moduleName, (countMap.get(moduleName) ?? 0) + 1);
  }

  return countMap;
}
