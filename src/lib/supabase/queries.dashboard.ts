/**
 * queries.dashboard.ts
 *
 * Revision-aware update (2025):
 *  - Only fetches step_results for test_steps_id explicitly listed in active
 *    revision step_order. No bulk test_steps fetching.
 *  - is_divider parsed from step_order string format: {serial}-{rev}-{group}-{step}-{is_divider}
 *  - Legacy tests (no active revision) fetch step_results via test_steps join.
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
  step_order: string[];
}

export interface DashboardModuleTest {
  id: string;
  tests_name: string;
  test: { name: string; serial_no: string | null } | null;
  active_revision: DashboardRevision | null;
}

export interface DashboardStepResult {
  status: string;
  test_steps_id: string;
  is_divider: boolean;
  tests_serial_no: string;
}

export interface DashboardModule {
  name: string;
  description: string | null;
  module_tests: DashboardModuleTest[];
  step_results: DashboardStepResult[];
}

// ── Parse is_divider from step_order string ─────────────────────────────────
// Format: "T001-R0-1-1-false" → tests_serial_no=T001, is_divider=false
function parseStepKey(stepKey: string): { tests_serial_no: string; is_divider: boolean } {
  const parts = stepKey.split('-');
  const isDividerStr = parts[parts.length - 1]; // last part: "true" or "false"
  return {
    tests_serial_no: parts[0],
    is_divider: isDividerStr === 'true',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchDashboardModules
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchDashboardModules(): Promise<DashboardModule[]> {
  // ── 1. Fetch modules + module_tests ──────────────────────────────────────
  const { data: modulesRaw, error: modErr } = await supabase
    .from("modules")
    .select(`
      name,
      description,
      module_tests:module_tests!module_name(
        id,
        tests_name,
        test:tests!module_tests_tests_name_fkey(name, serial_no)
      )
    `)
    .order("name");

  if (modErr) throw new Error(modErr.message);
  const modulesData = (modulesRaw ?? []) as any[];

  // ── 2. Collect every unique tests_serial_no ──────────────────────────────
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

  // ── 3. Batch-fetch active revisions ──────────────────────────────────────
  const { data: revRaw, error: revErr } = await supabase
    .from("test_revisions")
    .select("id, revision, is_visible, tests_serial_no, step_order")
    .eq("status", "active")
    .in("tests_serial_no", allSerialNos);

  if (revErr) throw new Error(revErr.message);

  const revBySerial: Record<string, DashboardRevision> = {};
  ((revRaw ?? []) as any[]).forEach((r) => {
    revBySerial[r.tests_serial_no] = {
      id: r.id,
      revision: r.revision,
      is_visible: r.is_visible,
      step_order: Array.isArray(r.step_order) ? (r.step_order as string[]) : [],
    };
  });

  const serialNosWithoutRevision = new Set(
    allSerialNos.filter((sn) => !revBySerial[sn])
  );

  // ── 4. Collect all step IDs from active revisions ────────────────────────
  const allStepIdsFromRevisions = new Set<string>();
  for (const rev of Object.values(revBySerial)) {
    for (const stepId of rev.step_order) {
      allStepIdsFromRevisions.add(stepId);
    }
  }

  // ── 5. Fetch step_results ──────────────────────────────────────────────
//
// For each module, we need step_results for its tests' step_order items,
// scoped by module_name. Since step_results are unique per (test, module),
// we must include module_name in the query.

// Build a map: module_name → Set of test_steps_id for that module
const moduleStepIds: Record<string, Set<string>> = {};

for (const mod of modulesData) {
  const modName = mod.name as string;
  moduleStepIds[modName] = new Set();

  const mts = (mod.module_tests ?? []) as any[];
  for (const mt of mts) {
    const serialNo = mt.test?.serial_no as string | undefined;
    if (!serialNo) continue;

    const rev = revBySerial[serialNo];
    if (rev) {
      for (const stepId of rev.step_order) {
        moduleStepIds[modName].add(stepId);
      }
    }
  }
}

// Fetch step_results per module (or batch by module_name if Supabase supports)
// Since .in() doesn't work well with composite (module_name, test_steps_id),
// we fetch all step_results for the test_steps_id set, then filter in JS by module_name.

const allStepIds = Array.from(
  new Set(Object.values(moduleStepIds).flatMap((s) => Array.from(s)))
);

const srPromises: PromiseLike<any>[] = [];

if (allStepIds.length > 0) {
  srPromises.push(
    supabase
      .from("step_results")
      .select("status, test_steps_id, module_name")
      .in("test_steps_id", allStepIds)
  );
}

// Legacy path: fetch by tests_serial_no + module_name
if (serialNosWithoutRevision.size > 0) {
  // For legacy, we need to know which (serial_no, module_name) pairs exist
  // Build a set of module_names that have legacy tests
  const legacyModuleNames = new Set<string>();
  for (const mod of modulesData) {
    const mts = (mod.module_tests ?? []) as any[];
    for (const mt of mts) {
      const serialNo = mt.test?.serial_no as string | undefined;
      if (serialNo && serialNosWithoutRevision.has(serialNo)) {
        legacyModuleNames.add(mod.name as string);
      }
    }
  }

  srPromises.push(
    supabase
      .from("step_results")
      .select(`
        status,
        test_steps_id,
        module_name,
        step:test_steps!step_results_test_steps_id_fkey(
          is_divider,
          tests_serial_no
        )
      `)
      .in("step.tests_serial_no", Array.from(serialNosWithoutRevision))
      .in("module_name", Array.from(legacyModuleNames))
  );
}



// Build lookup: (module_name, test_steps_id) → status
const statusByModuleStep = new Map<string, string>();
// Build lookup for legacy: test_steps_id → {is_divider, tests_serial_no}
const metaByStepId = new Map<string, { is_divider: boolean; tests_serial_no: string }>();

const srResponses = await Promise.all(srPromises);
for (const res of srResponses) {
  if (res.error) throw new Error(res.error.message);
}

for (const row of srResponses.flatMap((r) => (r.data ?? []) as any[])) {
  const key = `${row.module_name}:${row.test_steps_id}`;
  statusByModuleStep.set(key, row.status as string);

  if (row.step) {
    metaByStepId.set(row.test_steps_id as string, {
      is_divider: row.step.is_divider ?? false,
      tests_serial_no: row.step.tests_serial_no ?? "",
    });
  }
}

// ── 6. Assemble final DashboardModule array ──────────────────────────────
return modulesData.map((mod): DashboardModule => {
  const modName = mod.name as string;
  const enrichedMts: DashboardModuleTest[] = ((mod.module_tests ?? []) as any[]).map(
    (mt: any) => ({
      id: mt.id,
      tests_name: mt.tests_name,
      test: mt.test ?? null,
      active_revision: revBySerial[mt.test?.serial_no ?? ""] ?? null,
    })
  );

  const moduleStepResults: DashboardStepResult[] = [];

  for (const mt of enrichedMts) {
    const rev = mt.active_revision;
    const serialNo = (mt.test?.serial_no ?? "") as string;

    if (rev && rev.step_order.length > 0) {
      // Revised path: lookup by (module_name, test_steps_id)
      for (const stepId of rev.step_order) {
        const parsed = parseStepKey(stepId);
        if (parsed.tests_serial_no !== serialNo) continue;

        const key = `${modName}:${stepId}`;
        const status = statusByModuleStep.get(key) ?? "pending";

        moduleStepResults.push({
          status,
          test_steps_id: stepId,
          is_divider: parsed.is_divider,
          tests_serial_no: parsed.tests_serial_no,
        });
      }
    } else {
      // Legacy path: lookup by (module_name, test_steps_id) using meta
      for (const [stepId, meta] of metaByStepId.entries()) {
        if (meta.tests_serial_no !== serialNo) continue;

        const key = `${modName}:${stepId}`;
        const status = statusByModuleStep.get(key) ?? "pending";

        moduleStepResults.push({
          status,
          test_steps_id: stepId,
          is_divider: meta.is_divider,
          tests_serial_no: meta.tests_serial_no,
        });
      }
    }
  }

  return {
    name: modName,
    description: mod.description ?? null,
    module_tests: enrichedMts,
    step_results: moduleStepResults,
  };
});
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

    const moduleStepResults: DashboardStepResult[] = [];

    for (const mt of enrichedMts) {
      const rev = mt.active_revision;
      const serialNo = (mt.test?.serial_no ?? "") as string;

      if (rev && rev.step_order.length > 0) {
        // Revised path: use step_order directly, parse metadata from string
        for (const stepId of rev.step_order) {
          const parsed = parseStepKey(stepId);

          // Safety check: ensure this step belongs to this test
          if (parsed.tests_serial_no !== serialNo) continue;

          const status = statusByStepId.get(stepId) ?? "pending";

          moduleStepResults.push({
            status,
            test_steps_id: stepId,
            is_divider: parsed.is_divider,
            tests_serial_no: parsed.tests_serial_no,
          });
        }
      } else {
        // Legacy path: use fetched metadata from step_results join
        for (const [stepId, meta] of metaByStepId.entries()) {
          if (meta.tests_serial_no !== serialNo) continue;

          const status = statusByStepId.get(stepId) ?? "pending";

          moduleStepResults.push({
            status,
            test_steps_id: stepId,
            is_divider: meta.is_divider,
            tests_serial_no: meta.tests_serial_no,
          });
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
// fetchActiveLocks
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
// fetchOtherActiveLockModules
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchOtherActiveLockModules(): Promise<Map<string, number>> {
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