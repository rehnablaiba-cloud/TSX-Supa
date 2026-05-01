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
 *  - step_results fetched in parallel batches of 100 to avoid PostgREST URL limits.
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


// ─────────────────────────────────────────────────────────────────────────────
// Progress callback type
// ─────────────────────────────────────────────────────────────────────────────

export type FetchProgressCallback = (
  phase: string,
  done: number,
  total: number
) => void;


// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Split an array into chunks of `size`. */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const STEP_BATCH_SIZE = 100;

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


// ─────────────────────────────────────────────────────────────────────────────
// fetchDashboardModules
// ─────────────────────────────────────────────────────────────────────────────


export async function fetchDashboardModules(
  onProgress?: FetchProgressCallback
): Promise<DashboardModule[]> {

  // ── 1. Fetch modules + module_tests (now includes is_visible) ────────────
  onProgress?.("Fetching modules…", 0, 1);

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

  onProgress?.("Modules loaded", 1, 1);


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
    onProgress?.("Done — no tests found", 1, 1);
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
  onProgress?.("Fetching revisions…", 0, 1);

  const { data: revRaw, error: revErr } = await supabase
    .from("test_revisions")
    .select("id, revision, tests_serial_no, step_order")
    .eq("status", "active")
    .in("tests_serial_no", allSerialNos);

  if (revErr) throw new Error(revErr.message);

  onProgress?.("Revisions loaded", 1, 1);

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


  // ── 5. Fetch step_results in parallel chunks of 100 ──────────────────────
  const statusByModuleStep = new Map<string, string>();
  const metaByStepId = new Map<string, { is_divider: boolean; tests_serial_no: string }>();

  if (allStepIds.length > 0) {
    const batches = chunkArray(allStepIds, STEP_BATCH_SIZE);
    const totalBatches = batches.length;

    onProgress?.("Fetching step results…", 0, totalBatches);

    // Fire all batch queries in parallel
    const batchResults = await Promise.all(
      batches.map((batch) =>
        supabase
          .from("step_results")
          .select("status, test_steps_id, module_name")
          .in("test_steps_id", batch)
      )
    );

    // Process results with running progress ticks
    batchResults.forEach((res, i) => {
      if (res.error) throw new Error(res.error.message);

      for (const row of (res.data ?? []) as any[]) {
        const key = `${row.module_name}:${row.test_steps_id}`;
        statusByModuleStep.set(key, row.status as string);
      }

      onProgress?.("Fetching step results…", i + 1, totalBatches);
    });
  }

  // ── 5b. Legacy path: tests without an active revision ────────────────────
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

    onProgress?.(
      `Fetching legacy steps (${serialNosWithoutRevision.size} tests)…`,
      0,
      1
    );

    const { data: legacyData, error: legacyErr } = await supabase
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
      .in("module_name", Array.from(legacyModuleNames));

    if (legacyErr) throw new Error(legacyErr.message);

    for (const row of (legacyData ?? []) as any[]) {
      const key = `${row.module_name}:${row.test_steps_id}`;
      statusByModuleStep.set(key, row.status as string);

      if (row.step) {
        metaByStepId.set(row.test_steps_id as string, {
          is_divider: row.step.is_divider ?? false,
          tests_serial_no: row.step.tests_serial_no ?? "",
        });
      }
    }

    onProgress?.("Legacy steps loaded", 1, 1);
  }


  // ── 6. Assemble final DashboardModule array ──────────────────────────────
  onProgress?.("Assembling dashboard…", 1, 1);

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
