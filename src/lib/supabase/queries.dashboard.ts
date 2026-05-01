/**
 * queries.dashboard.ts
 *
 * Two-phase loading strategy:
 *
 *  Phase 1 — fetchDashboardShell()
 *    Fetches modules + revisions only (~fast).
 *    Returns DashboardShell with step_results: [] on every module.
 *    Dashboard renders cards immediately from this.
 *
 *  Phase 2 — streamStepResults()
 *    Step IDs are split into chunks of 500.
 *    Up to 100 chunks fire in parallel per wave; onBatch() fires once per wave
 *    so numbers/bars animate upward as each wave lands.
 *    Legacy tests (no active revision) are fetched in one trailing request.
 *    Accepts a cancellation token so superseded fetches abort cleanly.
 */
import { supabase } from "../../supabase";
import type { ActiveLock } from "../../types";


// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface DashboardRevision {
  id: string;
  revision: string;
  step_order: string[];
}

export interface DashboardModuleTest {
  id: string;
  tests_name: string;
  is_visible: boolean;
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

export type FetchProgressCallback = (
  phase: string,
  done: number,
  total: number
) => void;

/** Lightweight cancellation token — set cancelled = true to abort streaming. */
export interface StreamCancellationToken {
  cancelled: boolean;
}

/**
 * Result of Phase 1. Pass the whole object to streamStepResults().
 * The _internal fields are opaque — do not read them outside this module.
 */
export interface DashboardShell {
  /** Ready-to-render module cards. step_results is [] until Phase 2 fills it. */
  modules: DashboardModule[];
  /** @internal */ _revBySerial: Record<string, DashboardRevision>;
  /** @internal */ _allStepIds: string[];
  /** @internal */ _serialNosWithoutRevision: Set<string>;
  /** @internal */ _modulesData: any[];
  /** @internal */ _legacyModuleNames: Set<string>;
  /** @internal */ _enrichedMtsByModule: Map<string, DashboardModuleTest[]>;
}


// ─────────────────────────────────────────────────────────────────────────────
// Internal utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Step IDs per Supabase request. */
const BATCH_SIZE = 500;
/** Max concurrent requests per wave. onBatch() fires once per wave. */
const WAVE_SIZE  = 100;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Format: "T001-R0-1-1-false"
function parseStepKey(key: string): { tests_serial_no: string; is_divider: boolean } {
  const parts = key.split("-");
  const revIdx = parts.findIndex((p, i) => i > 0 && /^R\d+$/.test(p));
  return {
    tests_serial_no: revIdx > 0 ? parts.slice(0, revIdx).join("-") : parts[0],
    is_divider: parts[parts.length - 1] === "true",
  };
}

/** Rebuild all DashboardModule[] from the current step-status accumulator. */
function assembleModules(
  shell: DashboardShell,
  statusByModuleStep: Map<string, string>,
  metaByStepId: Map<string, { is_divider: boolean; tests_serial_no: string }>
): DashboardModule[] {
  return shell._modulesData.map((mod): DashboardModule => {
    const modName = mod.name as string;
    const enrichedMts = shell._enrichedMtsByModule.get(modName) ?? [];
    const stepResults: DashboardStepResult[] = [];

    for (const mt of enrichedMts) {
      const serialNo = mt.test?.serial_no ?? "";
      if (!serialNo) continue;
      const rev = mt.active_revision;

      if (rev && rev.step_order.length > 0) {
        for (const stepId of rev.step_order) {
          const parsed = parseStepKey(stepId);
          if (parsed.tests_serial_no !== serialNo) continue;
          stepResults.push({
            status: statusByModuleStep.get(`${modName}:${stepId}`) ?? "pending",
            test_steps_id: stepId,
            is_divider: parsed.is_divider,
            tests_serial_no: serialNo,
          });
        }
      } else {
        for (const [stepId, meta] of metaByStepId.entries()) {
          if (meta.tests_serial_no !== serialNo) continue;
          stepResults.push({
            status: statusByModuleStep.get(`${modName}:${stepId}`) ?? "pending",
            test_steps_id: stepId,
            is_divider: meta.is_divider,
            tests_serial_no: serialNo,
          });
        }
      }
    }

    return {
      name: modName,
      description: mod.description ?? null,
      module_tests: enrichedMts,
      step_results: stepResults,
    };
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 — fetchDashboardShell
// Fast: modules + revisions only. No step_results fetched here.
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchDashboardShell(
  onProgress?: FetchProgressCallback
): Promise<DashboardShell> {
  // ── Modules ──────────────────────────────────────────────────────────────
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

  // ── Collect serial numbers ────────────────────────────────────────────────
  const allSerialNos: string[] = Array.from(
    new Set(
      modulesData.flatMap((mod) =>
        ((mod.module_tests ?? []) as any[])
          .map((mt: any) => mt.test?.serial_no as string | undefined)
          .filter((s): s is string => !!s)
      )
    )
  );

  // Early exit if no tests at all
  if (allSerialNos.length === 0) {
    const emptyModules: DashboardModule[] = modulesData.map((mod) => ({
      name: mod.name as string,
      description: mod.description ?? null,
      module_tests: (mod.module_tests ?? []).map((mt: any) => ({
        ...mt,
        is_visible: mt.is_visible ?? true,
        active_revision: null,
      })),
      step_results: [],
    }));
    return {
      modules: emptyModules,
      _revBySerial: {},
      _allStepIds: [],
      _serialNosWithoutRevision: new Set(),
      _modulesData: modulesData,
      _legacyModuleNames: new Set(),
      _enrichedMtsByModule: new Map(emptyModules.map((m) => [m.name, m.module_tests])),
    };
  }

  // ── Active revisions ──────────────────────────────────────────────────────
  onProgress?.("Fetching revisions…", 0, 1);

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
      step_order: Array.isArray(r.step_order) ? (r.step_order as string[]) : [],
    };
  });
  onProgress?.("Revisions loaded", 1, 1);

  const serialNosWithoutRevision = new Set(allSerialNos.filter((sn) => !revBySerial[sn]));

  const allStepIds = Array.from(
    new Set(Object.values(revBySerial).flatMap((rev) => rev.step_order))
  );

  // ── Build enrichedMts + legacyModuleNames ─────────────────────────────────
  const enrichedMtsByModule = new Map<string, DashboardModuleTest[]>();
  const legacyModuleNames = new Set<string>();

  for (const mod of modulesData) {
    const modName = mod.name as string;
    const mts: DashboardModuleTest[] = ((mod.module_tests ?? []) as any[]).map(
      (mt: any) => {
        const sn = mt.test?.serial_no as string | undefined;
        if (sn && serialNosWithoutRevision.has(sn)) legacyModuleNames.add(modName);
        return {
          id: mt.id,
          tests_name: mt.tests_name,
          is_visible: mt.is_visible ?? true,
          test: mt.test ?? null,
          active_revision: revBySerial[sn ?? ""] ?? null,
        };
      }
    );
    enrichedMtsByModule.set(modName, mts);
  }

  // Shell modules — step_results intentionally empty
  const shellModules: DashboardModule[] = modulesData.map((mod) => ({
    name: mod.name as string,
    description: mod.description ?? null,
    module_tests: enrichedMtsByModule.get(mod.name as string) ?? [],
    step_results: [],
  }));

  return {
    modules: shellModules,
    _revBySerial: revBySerial,
    _allStepIds: allStepIds,
    _serialNosWithoutRevision: serialNosWithoutRevision,
    _modulesData: modulesData,
    _legacyModuleNames: legacyModuleNames,
    _enrichedMtsByModule: enrichedMtsByModule,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — streamStepResults
// 500 IDs per request, up to 100 in parallel per wave.
// onBatch() fires once per wave so the UI counts up live.
// ─────────────────────────────────────────────────────────────────────────────

export async function streamStepResults(
  shell: DashboardShell,
  onBatch: (updatedModules: DashboardModule[]) => void,
  onProgress?: FetchProgressCallback,
  token?: StreamCancellationToken
): Promise<void> {
  const statusByModuleStep = new Map<string, string>();
  const metaByStepId = new Map<string, { is_divider: boolean; tests_serial_no: string }>();
  const isCancelled = () => token?.cancelled;

  // ── Revision-based parallel waves ────────────────────────────────────────
  if (shell._allStepIds.length > 0) {
    const batches    = chunkArray(shell._allStepIds, BATCH_SIZE);
    const totalWaves = Math.ceil(batches.length / WAVE_SIZE);
    onProgress?.("Loading step results…", 0, totalWaves);

    for (let i = 0; i < batches.length; i += WAVE_SIZE) {
      if (isCancelled()) return;

      const wave = batches.slice(i, i + WAVE_SIZE);

      const results = await Promise.all(
        wave.map((batch) =>
          supabase
            .from("step_results")
            .select("status, test_steps_id, module_name")
            .in("test_steps_id", batch)
        )
      );

      if (isCancelled()) return;

      for (const { data, error } of results) {
        if (error) throw new Error(error.message);
        for (const row of (data ?? []) as any[]) {
          statusByModuleStep.set(`${row.module_name}:${row.test_steps_id}`, row.status as string);
        }
      }

      // One render per wave — bars and counts animate upward as each wave lands.
      onBatch(assembleModules(shell, statusByModuleStep, metaByStepId));
      onProgress?.("Loading step results…", Math.floor(i / WAVE_SIZE) + 1, totalWaves);
    }
  }

  // ── Legacy path — tests without an active revision ────────────────────────
  if (shell._serialNosWithoutRevision.size > 0 && !isCancelled()) {
    onProgress?.(`Loading legacy steps (${shell._serialNosWithoutRevision.size} tests)…`, 0, 1);

    const { data, error } = await supabase
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
      .in("step.tests_serial_no", Array.from(shell._serialNosWithoutRevision))
      .in("module_name", Array.from(shell._legacyModuleNames));

    if (error) throw new Error(error.message);

    for (const row of (data ?? []) as any[]) {
      statusByModuleStep.set(`${row.module_name}:${row.test_steps_id}`, row.status as string);
      if (row.step) {
        metaByStepId.set(row.test_steps_id as string, {
          is_divider: row.step.is_divider ?? false,
          tests_serial_no: row.step.tests_serial_no ?? "",
        });
      }
    }

    onBatch(assembleModules(shell, statusByModuleStep, metaByStepId));
    onProgress?.("Legacy steps loaded", 1, 1);
  }
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

  const idToModule = Object.fromEntries(module_tests.map((mt: any) => [mt.id, mt.module_name]));
  const countMap = new Map<string, number>();
  for (const lock of otherLocks) {
    const moduleName = idToModule[lock.module_test_id];
    if (!moduleName) continue;
    countMap.set(moduleName, (countMap.get(moduleName) ?? 0) + 1);
  }
  return countMap;
}