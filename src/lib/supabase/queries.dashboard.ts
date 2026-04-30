/**
 * queries.dashboard.ts
 *
 * Revision-aware update (2025):
 *  - fetchDashboardModules now fetches active revisions for every test in every
 *    module, then pulls step_results scoped to the test_steps referenced in
 *    those revision step_orders.
 *  - For tests that have no activated revision yet (legacy data) the fallback
 *    is step_results for all steps belonging to that test in that module.
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
  /** Module name to scope step_results per module. */
  module_name: string;
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

  /** serial_nos that have NO active revision — legacy fallback path */
  const serialNosWithoutRevision = new Set(
    allSerialNos.filter((sn) => !revBySerial[sn])
  );

  // ── 4. Fetch step_results ──────────────────────────────────────────────
  //
  // Fetch step_results for the test_steps referenced in active revisions'
  // step_order arrays, plus legacy rows for tests without revisions.
  // We use test_steps_id (from step_order) directly rather than revision_id
  // because step_results has a direct FK to test_steps.

  const srSelect = `
    status,
    test_steps_id,
    module_name,
    step:test_steps!step_results_test_steps_id_fkey(
      is_divider,
      tests_serial_no
    )
  `;

  // Collect all test_steps_id values from active revision step_orders
  const allStepIdsFromRevisions = new Set<string>();
  for (const rev of Object.values(revBySerial)) {
    for (const stepId of rev.step_order) {
      allStepIdsFromRevisions.add(stepId);
    }
  }

  const srPromises: PromiseLike<any>[] = [];

  if (allStepIdsFromRevisions.size > 0) {
    srPromises.push(
      supabase
        .from("step_results")
        .select(srSelect)
        .in("test_steps_id", Array.from(allStepIdsFromRevisions))
    );
  }

  if (serialNosWithoutRevision.size > 0) {
    srPromises.push(
      supabase
        .from("step_results")
        .select(srSelect)
        .in("step.tests_serial_no", Array.from(serialNosWithoutRevision))
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
      module_name: row.module_name as string,
      is_divider: (row.step?.is_divider ?? false) as boolean,
      tests_serial_no: (row.step?.tests_serial_no ?? "") as string,
    }));

  // ── 5. Build a lookup: test_steps_id → DashboardStepResult ─────────────────
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
          // Only include if it belongs to this module
          if (sr && sr.module_name === mod.name) moduleStepResults.push(sr);
        }
      } else {
        // Legacy path: all step_results for this test in this module
        const serialNo = (mt.test?.serial_no ?? "") as string;
        for (const sr of allStepResults) {
          if (sr.tests_serial_no === serialNo && sr.module_name === mod.name) {
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