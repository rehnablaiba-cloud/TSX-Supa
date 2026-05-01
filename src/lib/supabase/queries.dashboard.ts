/**
 * queries.dashboard.ts
 *
 * Revision-aware update (2025):
 *  - Only fetches step_results for test_steps_id explicitly listed in active
 *    revision step_order. No bulk test_steps fetching.
 *  - is_divider parsed from step_order string format: {serial}-{rev}-{group}-{step}-{is_divider}
 *  - Legacy tests (no active revision) fetch step_results via test_steps join.
 *  - step_results keyed by (module_name, test_steps_id) to prevent cross-module bleed.
 *  - is_visible now lives on module_tests (not test_revisions).
 */
import { supabase } from "../../supabase";
import type { ActiveLock } from "../../types";


// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────


export interface DashboardRevision {
  id: string;
  revision: string;
  // ✅ is_visible removed — now lives on DashboardModuleTest
  step_order: string[];
}


export interface DashboardModuleTest {
  id: string;
  tests_name: string;
  is_visible: boolean; // ✅ moved here from DashboardRevision
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


// ── Parse is_divider and tests_serial_no from step_order string ──────────────
// Format: "T001-R0-1-1-false"
function parseStepKey(stepKey: string): { tests_serial_no: string; is_divider: boolean } {
  const parts = stepKey.split('-');
  const isDividerStr = parts[parts.length - 1];

  const revIdx = parts.findIndex((p, i) => i > 0 && /^R\d+$/.test(p));
  const tests_serial_no = revIdx > 0 ? parts.slice(0, revIdx).join('-') : parts[0];

  return {
    tests_serial_no,
    is_divider: isDividerStr === 'true',
  };
}


// ── Chunk helper ─────────────────────────────────────────────────────────────
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}


// ─────────────────────────────────────────────────────────────────────────────
// fetchDashboardModules
// ─────────────────────────────────────────────────────────────────────────────


export async function fetchDashboardModules(): Promise<DashboardModule[]> {
  // ── 1. Fetch modules + module_tests (now includes is_visible) ────────────
  const { data: modulesRaw, error: modErr } = await supabase
    .from("modules")
    .select(`
      name,
      description,
      module_tests:module_tests!module_name(
        id,
        tests_name,
        is_visible,
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
        is_visible: mt.is_visible ?? true,
        active_revision: null,
      })),
      step_results: [],
    }));
  }


  // ── 3. Batch-fetch active revisions (is_visible removed from select) ─────
  const { data: revRaw, error: revErr } = await supabase
    .from("test_revisions")
    .select("id, revision, tests_serial_no, step_order")
    .eq("status", "active")
    .in("tests_serial_no", allSerialNos);

  if (revErr) throw new Error(revErr.message);

  const revBySerial: Record<string, DashboardRevision> = {};
  ((revRaw ?? []) as any[]).forEach((r) => {
    revBySerial[r.tests_serial_no] = {
      id: r.id,
      revision: r.revision,
      // ✅ is_visible no longer mapped here
      step_order: Array.isArray(r.step_order) ? (r.step_order as string[]) : [],
    };
  });

  const serialNosWithoutRevision = new Set(
    allSerialNos.filter((sn) => !revBySerial[sn])
  );


  // ── 4. Collect all step IDs from active revisions ────────────────────────
  const allStepIds = Array.from(
    new Set(
      Object.values(revBySerial).flatMap((rev) => rev.step_order)
    )
  );


  // ── 5. Fetch step_results — ALL IN PARALLEL ──────────────────────────────
  const statusByModuleStep = new Map<string, string>();
  const metaByStepId = new Map<string, { is_divider: boolean; tests_serial_no: string }>();

  const BATCH = 100;

  // Build all promises upfront, fire them in parallel
  const allPromises: Promise<any>[] = [];

  // 5a. Active revision path: chunk step IDs, parallel fetch
  if (allStepIds.length > 0) {
    const stepBatches = chunk(allStepIds, BATCH);
    for (const batch of stepBatches) {
      allPromises.push(
        supabase
          .from("step_results")
          .select("status, test_steps_id, module_name")
          .in("test_steps_id", batch)
          .then(r => r) // <-- .then() makes it a real Promise
      );
    }
  }

  // 5b. Legacy path (no active revision): chunk serial nos + module names, parallel fetch
  if (serialNosWithoutRevision.size > 0) {
    const legacyModuleNames = new Set<string>();
    for (const mod of modulesData) {
      for (const mt of (mod.module_tests ?? []) as any[]) {
        const sn = mt.test?.serial_no as string | undefined;
        if (sn && serialNosWithoutRevision.has(sn)) {
          legacyModuleNames.add(mod.name as string);
        }
      }
    }

    const legacySerialBatches = chunk(Array.from(serialNosWithoutRevision), BATCH);
    const legacyModuleBatches = chunk(Array.from(legacyModuleNames), BATCH);

    // Cartesian product of batches — each combo is one parallel query
    for (const serialBatch of legacySerialBatches) {
      for (const moduleBatch of legacyModuleBatches) {
        allPromises.push(
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
            .in("step.tests_serial_no", serialBatch)
            .in("module_name", moduleBatch)
            .then(r => r) // <-- .then() makes it a real Promise
        );
      }
    }
  }

  // 🔥 Fire ALL requests in parallel
  const srResponses = await Promise.all(allPromises);

  // Check errors after all settle
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
        is_visible: mt.is_visible ?? true, // ✅ read from module_tests row
        test: mt.test ?? null,
        active_revision: revBySerial[mt.test?.serial_no ?? ""] ?? null,
      })
    );

    const moduleStepResults: DashboardStepResult[] = [];

    for (const mt of enrichedMts) {
      const rev = mt.active_revision;
      const serialNo = (mt.test?.serial_no ?? "") as string;

      if (!serialNo) continue;

      if (rev && rev.step_order.length > 0) {
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

  // ── CHUNKED + PARALLEL fetch for module_tests ──
  const BATCH = 100;
  const batches = chunk(module_test_ids, BATCH);
  const mtPromises = batches.map(batch =>
    supabase
      .from("module_tests")
      .select("id, module_name, tests_name")
      .in("id", batch)
      .then(r => r) // <-- .then() makes it a real Promise
  );

  const mtResponses = await Promise.all(mtPromises);
  for (const res of mtResponses) {
    if (res.error) throw new Error(res.error.message);
  }

  const module_tests = mtResponses.flatMap((r) => (r.data ?? []) as any[]);

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

  // ── CHUNKED + PARALLEL fetch for module_tests ──
  const BATCH = 100;
  const batches = chunk(module_test_ids, BATCH);
  const mtPromises = batches.map(batch =>
    supabase
      .from("module_tests")
      .select("id, module_name")
      .in("id", batch)
      .then(r => r) // <-- .then() makes it a real Promise
  );

  const mtResponses = await Promise.all(mtPromises);
  for (const res of mtResponses) {
    if (res.error) throw new Error(res.error.message);
  }

  const module_tests = mtResponses.flatMap((r) => (r.data ?? []) as any[]);

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
