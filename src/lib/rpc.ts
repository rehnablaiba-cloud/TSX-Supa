/**
 * src/lib/rpc.ts
 *
 * Single import surface for all Supabase queries and mutations.
 * Components import ONLY from this file — never from supabase or r2 directly.
 *
 * Data routing:
 *   R2  (static / non-changing) → modules · tests · revisions · step_orders · test_steps
 *   Supabase (dynamic)          → module_tests · step_results · test_locks ·
 *                                  profiles · audit_log · count RPCs
 *
 * Sections:
 *   1.  Shared types
 *   2.  Internal helpers
 *   3.  Shared queries      getModuleTests · getActiveRevisions · getModuleLocks
 *   4.  Dashboard
 *   5.  Module Dashboard
 *   6.  Test Execution
 *   7.  Test Report
 *   8.  Audit Log           minimal — test_started / test_finished only
 *   9.  Admin
 */

import { supabase } from "../supabase";
import {
  r2GetModules,
  r2GetTests,
  r2GetActiveRevisions,
  r2GetStepOrder,
  r2GetTestSteps,
  type R2Step,
} from "./r2";
import { r2ListStepImages, type StepImageUrls } from "./r2Images"

// ═════════════════════════════════════════════════════════════════════════════
// Session Expired Signal  (merged from rpc.interceptor.ts)
// ═════════════════════════════════════════════════════════════════════════════

type SessionExpiredListener = () => void;

class SessionExpiredSignal {
  private listeners = new Set<SessionExpiredListener>();

  subscribe(fn: SessionExpiredListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    this.listeners.forEach((fn) => fn());
  }
}

export const sessionExpiredSignal = new SessionExpiredSignal();

// ── Internal: session token for R2 worker calls ───────────────────────────────
async function getWorkerToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error("Not authenticated")
  return session.access_token
}

// ═════════════════════════════════════════════════════════════════════════════
// callRpc — global 401 interceptor
// ═════════════════════════════════════════════════════════════════════════════

function is401(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  return e["status"] === 401 || e["code"] === "PGRST301";
}

export async function callRpc<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!is401(err)) throw err;

    const { error: refreshError } = await supabase.auth.refreshSession();

    if (refreshError) {
      sessionExpiredSignal.emit();
      throw err;
    }

    return await fn();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Types
// ─────────────────────────────────────────────────────────────────────────────

// ── Shared ────────────────────────────────────────────────────────────────────

export type ModuleTestItem = {
  id:         string;
  tests_name: string;
  is_visible: boolean;
  test: { serial_no: string; name: string } | null;
};

export type ActiveRevision = {
  id:              string;
  revision:        string;
  tests_serial_no: string;
};

/** @deprecated step_order is fetched separately from R2 via r2GetStepOrder(). */
export type ActiveRevisionWithSteps = ActiveRevision & {
  step_order: string[];
};

export type LockRow = {
  module_test_id: string;
  user_id:        string;
  locked_by_name: string;
  locked_at:      string;
};

// ── Dashboard ─────────────────────────────────────────────────────────────────

export type ModuleOption = { name: string };

export type DashboardModuleSummary = {
  name:        string;
  description: string | null;
  test_count:  number;
  pass:        number;
  fail:        number;
  pending:     number;
  total:       number;
};

export type ActiveLock = {
  module_test_id: string;
  module_name:    string;
  test_name:      string;
  locked_at:      string;
};

// ── Module Dashboard ──────────────────────────────────────────────────────────

export type ModuleTestRow = {
  id:         string;
  tests_name: string;
  is_visible: boolean;
  test: { serial_no: string; name: string } | null;
  pass:    number;
  fail:    number;
  pending: number;
  total:   number;
};

export type TrimmedStepResult = {
  id:     string;
  status: "pass" | "fail" | "pending";
  step: {
    id:              string;
    is_divider:      boolean;
    tests_serial_no: string;
    serial_no:       number;
    action:          string;
    expected_result: string;
  } | null;
};

export type ModuleData = {
  module_tests: ModuleTestRow[];
  locks:        Record<string, LockRow>;
  revisions:    Record<string, ActiveRevision>;
};

// ── Test Execution ────────────────────────────────────────────────────────────

export type RawStepResult = {
  id:           string;
  status:       "pass" | "fail" | "pending";
  remarks:      string;
  display_name: string;
  step: {
    id:                  string;
    serial_no:           number;
    action:              string;
    expected_result:     string;
    is_divider:          boolean;
    action_image_urls:   string[];
    expected_image_urls: string[];
    tests_serial_no:     string;
  } | null;
};

export type RawModuleTestItem = {
  id:         string;
  tests_name: string;
  is_visible: boolean;
  test: { serial_no: string; name: string } | null;
};

/**
 * Structural half of the execution view — everything except live step results.
 * Cached aggressively; only changes when an admin publishes a new revision.
 */
export type TestExecutionContext = {
  module_name:      string;
  is_visible:       boolean;
  current_revision: ActiveRevision | null;
  active_revisions: Record<string, ActiveRevision>;
  module_tests:     RawModuleTestItem[];
};

export type TestExecutionData = TestExecutionContext & {
  step_results: RawStepResult[];
};

// ── Test Report ───────────────────────────────────────────────────────────────

export type SessionHistoryEntry = {
  id:              string;
  module_name:     string;
  tests_serial_no: string;
  test_name:       string;
  status:          "pass" | "fail" | "pending";
  updated_at:      string;
  revision:        string | null;
  is_divider:      boolean;
};

export type SessionGroup = {
  module_name:     string;
  tests_serial_no: string;
  test_name:       string;
  revision:        string | null;
  steps:           SessionHistoryEntry[];
  pass:            number;
  fail:            number;
  undo:            number;
  total:           number;
  last_updated:    string;
};

// ── Audit Log ─────────────────────────────────────────────────────────────────

export type AuditEventType = "test_started" | "test_finished";

export type AuditLog = {
  id:           string;
  event_type:   AuditEventType;
  module_name:  string;
  test_name:    string;
  display_name: string;
  result:       "pass" | "fail" | "pending" | null;
  created_at:   string;
};

// ── Admin ─────────────────────────────────────────────────────────────────────

export type TestOption = {
  serial_no: string;
  name:      string;
};

export type TableName =
  | "profiles"
  | "modules"
  | "tests"
  | "test_steps"
  | "module_tests"
  | "step_results"
  | "test_locks"
  | "audit_log";

export type AllData = Record<TableName, Record<string, unknown>[]>;

export type StepOption = {
  id:              string;
  serial_no:       number;
  tests_serial_no: string;
  action:          string;
  expected_result: string;
  is_divider:      boolean;
};

export type ManualStepPayload = {
  tests_serial_no: string;
  serial_no:       number;
  action:          string;
  expected_result: string;
  is_divider:      boolean;
};

export type CsvStepRow = {
  tests_serial_no: string;
  serial_no:       number;
  action:          string;
  expected_result: string;
  is_divider:      boolean;
};

// ── Lock Status ───────────────────────────────────────────────────────────────

export type LockStatus =
  | { status: "free" }
  | { status: "locked-by-self"; holderName?: string }
  | { status: "locked-by-other"; holderName: string };

// ─────────────────────────────────────────────────────────────────────────────
// 2. Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function unwrapOne<T>(val: T | T[] | null | undefined): T | null {
  if (val == null) return null;
  if (Array.isArray(val)) return val[0] ?? null;
  return val;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function assertAdmin(): Promise<void> {
  return callRpc(async () => {
    const { data, error } = await supabase.rpc("is_admin");
    if (error) throw new Error(`Admin check failed: ${error.message}`);
    if (!data) throw new Error("Forbidden: admin privileges required.");
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Shared queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All tests in a module with their test metadata.
 * Source: Supabase — module_tests is dynamic (is_visible can change).
 *
 * Cache key: ['moduleTests', module_name]
 * staleTime: 2 min  |  gcTime: 30 min
 */
export function getModuleTests(
  module_name: string
): Promise<ModuleTestItem[]> {
  return callRpc(async () => {
    const { data, error } = await supabase
      .from("module_tests")
      .select(
        "id, tests_name, is_visible, test:tests!module_tests_tests_name_fkey(serial_no, name)"
      )
      .eq("module_name", module_name)
      .order("tests_name");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ModuleTestItem[];
  });
}

/**
 * Active revision for each test in serialNos.
 * Source: R2 (revisions/all.json) — revisions are static once published.
 *
 * The `includeStepOrder` parameter is retained for API compatibility but is
 * a no-op. Step order is fetched separately from R2 via r2GetStepOrder().
 *
 * Cache key: ['activeRevisions', ...serialNos.sort()]
 * staleTime: 5 min  |  gcTime: 30 min
 */
export function getActiveRevisions(
  serialNos: string[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _includeStepOrder = false
): Promise<Record<string, ActiveRevision>> {
  return callRpc(async () => {
    if (!serialNos.length) return {};
    return r2GetActiveRevisions(serialNos) as Promise<Record<string, ActiveRevision>>;
  });
}

/**
 * All locks for the given module_test_ids.
 * Source: Supabase — locks are purely dynamic.
 *
 * Cache key: ['moduleLocks', module_name]
 * staleTime: 0  |  gcTime: 5 min
 */
export function getModuleLocks(
  moduleTestIds: string[]
): Promise<Record<string, LockRow>> {
  return callRpc(async () => {
    if (!moduleTestIds.length) return {};

    const { data, error } = await supabase
      .from("test_locks")
      .select("module_test_id, user_id, locked_by_name, locked_at")
      .in("module_test_id", moduleTestIds);

    if (error) throw new Error(error.message);

    return Object.fromEntries(
      ((data ?? []) as LockRow[]).map((l) => [l.module_test_id, l])
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Dashboard
// ─────────────────────────────────────────────────────────────────────────────

type RpcDashboardCountRow = {
  module_name:   string;
  test_count:    number;
  pass_count:    number;
  fail_count:    number;
  pending_count: number;
  total_count:   number;
};

/**
 * All modules with aggregated pass/fail/pending counts.
 *
 * Parallel:
 *   - get_dashboard_counts RPC  (Supabase — live counts)
 *   - modules/all.json          (R2 — module names + descriptions)
 *
 * Cache key: ['dashboardSummaries']
 * staleTime: 30s  |  gcTime: 10 min
 */
export function fetchDashboardSummaries(): Promise<DashboardModuleSummary[]> {
  return callRpc(async () => {
    const [countsResult, r2Modules] = await Promise.all([
      supabase.rpc("get_dashboard_counts"),
      r2GetModules(),
    ]);

    if (countsResult.error) throw new Error(countsResult.error.message);

    const countMap = new Map<string, RpcDashboardCountRow>();
    for (const row of (countsResult.data ?? []) as RpcDashboardCountRow[]) {
      countMap.set(row.module_name, row);
    }

    return r2Modules.map((mod): DashboardModuleSummary => {
      const cnt = countMap.get(mod.name);
      return {
        name:        mod.name,
        description: mod.description,
        test_count:  Number(cnt?.test_count    ?? 0),
        pass:        Number(cnt?.pass_count    ?? 0),
        fail:        Number(cnt?.fail_count    ?? 0),
        pending:     Number(cnt?.pending_count ?? 0),
        total:       Number(cnt?.total_count   ?? 0),
      };
    });
  });
}

/**
 * Current user's active locks with module + test names resolved.
 * Source: Supabase — fully dynamic.
 *
 * Cache key: ['activeLocks']
 * staleTime: 0  |  gcTime: 5 min
 */
export function fetchActiveLocks(): Promise<ActiveLock[]> {
  return callRpc(async () => {
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

    const mtMap = Object.fromEntries(
      module_tests.map((mt: any) => [mt.id, mt])
    );

    return locks.map((l: any) => {
      const mt = mtMap[l.module_test_id];
      return {
        module_test_id: l.module_test_id,
        module_name:    mt?.module_name ?? "Unknown Module",
        test_name:      mt?.tests_name  ?? "Unknown Test",
        locked_at:      l.locked_at ?? "",
      };
    });
  });
}

/**
 * Count of other users' active locks per module name.
 * Source: Supabase — fully dynamic.
 *
 * Cache key: ['otherActiveLocks']
 * staleTime: 0  |  gcTime: 5 min
 */
export function fetchOtherActiveLockModules(): Promise<Map<string, number>> {
  return callRpc(async () => {
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
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Module Dashboard
// ─────────────────────────────────────────────────────────────────────────────

type RpcModuleCountRow = {
  tests_serial_no: string;
  pass_count:      number;
  fail_count:      number;
  pending_count:   number;
  total_count:     number;
};

/**
 * All data for ModuleDashboard in one parallel round-trip.
 *
 * Parallel:
 *   - get_module_counts RPC  (Supabase — live counts)
 *   - module_tests list      (Supabase — visibility + test assignments)
 *   - test_locks             (Supabase — who holds locks)
 *   - revisions/all.json     (R2 — active revisions, filtered to this module)
 *
 * Cache key: compose from ['moduleTests', name] + ['moduleCounts', name] +
 *            ['activeRevisions', ...sns] + ['moduleLocks', name]
 */
export function fetchModuleData(module_name: string): Promise<ModuleData> {
  return callRpc(async () => {
    // ── Round 1: all sources in parallel ──────────────────────────────────────
    const [countsResult, testsResult, allRevisions] = await Promise.all([
      supabase.rpc("get_module_counts", { p_module_name: module_name }),
      supabase
        .from("module_tests")
        .select(
          "id, tests_name, is_visible, test:tests!module_tests_tests_name_fkey(serial_no, name)"
        )
        .eq("module_name", module_name),
      r2GetActiveRevisions(), // cached — cheap if already warm
    ]);

    if (countsResult.error) throw new Error(countsResult.error.message);
    if (testsResult.error)  throw new Error(testsResult.error.message);

    const rawTests      = (testsResult.data ?? []) as any[];
    const moduleTestIds = rawTests.map((mt) => mt.id as string);
    const serialNos: string[] = rawTests
      .map((mt) => mt.test?.serial_no as string | undefined)
      .filter((s): s is string => !!s);

    // ── Round 2: locks (needs moduleTestIds from round 1) ─────────────────────
    const locksResult =
      moduleTestIds.length > 0
        ? await supabase
            .from("test_locks")
            .select("module_test_id, user_id, locked_by_name, locked_at")
            .in("module_test_id", moduleTestIds)
        : { data: [] as any[], error: null };

    if (locksResult.error) throw new Error(locksResult.error.message);

    // ── Count map ──────────────────────────────────────────────────────────────
    const countMap = new Map<string, RpcModuleCountRow>();
    for (const row of (countsResult.data ?? []) as RpcModuleCountRow[]) {
      countMap.set(row.tests_serial_no, row);
    }

    // ── Revision map — scoped to this module's tests ───────────────────────────
    const revisions: Record<string, ActiveRevision> = {};
    for (const sno of serialNos) {
      const rev = allRevisions[sno];
      if (rev) revisions[sno] = rev as ActiveRevision;
    }

    // ── Lock map ───────────────────────────────────────────────────────────────
    const locks: Record<string, LockRow> = {};
    for (const l of (locksResult.data ?? []) as LockRow[]) {
      locks[l.module_test_id] = l;
    }

    // ── Build ModuleTestRow[] ──────────────────────────────────────────────────
    const module_tests: ModuleTestRow[] = rawTests
      .map((mt): ModuleTestRow => {
        const test   = unwrapOne(mt.test) as { serial_no: string; name: string } | null;
        const counts = test?.serial_no ? countMap.get(test.serial_no) : undefined;
        return {
          id:         mt.id         as string,
          tests_name: mt.tests_name as string,
          is_visible: (mt.is_visible ?? true) as boolean,
          test,
          pass:    Number(counts?.pass_count    ?? 0),
          fail:    Number(counts?.fail_count    ?? 0),
          pending: Number(counts?.pending_count ?? 0),
          total:   Number(counts?.total_count   ?? 0),
        };
      })
      .sort((a, b) => {
        const aS = a.test?.serial_no ?? "";
        const bS = b.test?.serial_no ?? "";
        return aS.localeCompare(bS, undefined, { numeric: true, sensitivity: "base" });
      });

    return { module_tests, locks, revisions };
  });
}

/**
 * Lightweight lock refresh — called by Realtime subscription in ModuleDashboard.
 */
export function fetchModuleLocks(
  moduleTestIds: string[]
): Promise<Record<string, LockRow>> {
  return callRpc(async () => getModuleLocks(moduleTestIds));
}

/**
 * Full step-result rows for CSV / PDF export.
 * Source: Supabase join — step_results + test_steps (both still in Supabase for server-side joins).
 * Only called when the user opens the export modal.
 *
 * Cache key: ['moduleStepDetails', module_name]
 * staleTime: 0  |  gcTime: 5 min
 */
export function fetchModuleStepDetails(
  module_name: string
): Promise<Record<string, TrimmedStepResult[]>> {
  return callRpc(async () => {
    const STEP_RESULT_SELECT =
      "id, status, test_steps_id, step:test_steps!step_results_test_steps_id_fkey(id, is_divider, tests_serial_no, serial_no, action, expected_result)";

    const { data, error } = await supabase
      .from("step_results")
      .select(STEP_RESULT_SELECT)
      .eq("module_name", module_name);

    if (error) throw new Error(error.message);

    const bySerial: Record<string, TrimmedStepResult[]> = {};
    for (const row of data ?? []) {
      const step = (
        Array.isArray(row.step) ? row.step[0] : row.step
      ) as TrimmedStepResult["step"];
      if (!step) continue;
      const key = step.tests_serial_no;
      (bySerial[key] ??= []).push({ id: row.id, status: row.status, step });
    }
    return bySerial;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Test Execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Structural data for TestExecution — module layout + active revision.
 * Does NOT include step results (fetched separately via fetchTestExecutionStepResults).
 *
 * Round 1 — parallel:
 *   - module_tests   (Supabase — is_visible + test assignments)
 *   - test_revisions (Supabase — active revision for this test)
 *   - all revisions  (R2 — nav badge map, typically a warm cache hit)
 *
 * Cache key : ['executionContext', module_test_id]
 * staleTime : Infinity  — invalidated only on admin revision publish
 * gcTime    : 10 min
 */
export function fetchTestExecutionContext(
  module_test_id: string,
  module_name:    string
): Promise<TestExecutionContext> {
  return callRpc(async () => {
    const { data: mtData, error: mtError } = await supabase
      .from("module_tests")
      .select("id, tests_name, is_visible, test:tests!module_tests_tests_name_fkey(serial_no, name)")
      .eq("module_name", module_name)
      .order("tests_name");

    if (mtError) throw new Error(mtError.message);

    const module_tests    = (mtData ?? []) as unknown as RawModuleTestItem[];
    const currentMt       = module_tests.find((mt) => mt.id === module_test_id);
    const is_visible      = currentMt?.is_visible ?? true;
    const currentSerialNo = (currentMt as any)?.test?.serial_no as string | undefined;

    let current_revision: ActiveRevision | null = null;

    if (currentSerialNo) {
      const { data: revData, error: revError } = await supabase
        .from("test_revisions")
        .select("id, revision, tests_serial_no")
        .eq("tests_serial_no", currentSerialNo)
        .eq("status", "active")
        .maybeSingle();

      if (revError) throw new Error(revError.message);
      current_revision = revData as ActiveRevision | null;
      console.log("[debug] current_revision:", current_revision);
    }

    // Nav-badge revision map — R2 cached, cheap
    const allRevisions = await r2GetActiveRevisions();
    const active_revisions: Record<string, ActiveRevision> = {};
    for (const [sno, rev] of Object.entries(allRevisions)) {
      active_revisions[sno] = rev as ActiveRevision;
    }

    return { module_name, is_visible, current_revision, active_revisions, module_tests };
  });
}

/**
 * Live step results for a specific revision + module.
 *
 * Fetch order:
 *   1. R2: step_order/{revision_id}.json  → ordered array of step UUIDs
 *   2. R2: test_steps/{revision_id}.json  → step metadata keyed by UUID
 *   3. Supabase RPC get_step_results      → step_results rows filtered by
 *        module_name = p_module_name
 *        test_steps_id IN (stepOrder)     ← revision + test scoped via R2 IDs
 *   4. JS merge: walk stepOrder, zip step metadata + result row
 *
 * Filters in effect:
 *   - module_name  : explicit RPC param
 *   - test_steps_id: explicit IN list from R2 step_order (revision + test scoped)
 *   - revision     : implicit — stepOrder UUIDs belong to exactly one revision
 *   - test         : implicit — each revision belongs to exactly one test
 *
 * Cache key : ['executionStepResults', revision_id, module_name]
 * staleTime : 0   — always re-fetches on mount; returning users never see stale state
 * gcTime    : 5 min
 */
export function fetchTestExecutionStepResults(
  revision_id: string,
  module_name: string
): Promise<RawStepResult[]> {
  return callRpc(async () => {
    const [stepOrder, r2Steps] = await Promise.all([
      r2GetStepOrder(revision_id),
      r2GetTestSteps(revision_id),
    ]);

    const { data: srData, error: srError } = await supabase.rpc("get_step_results", {
      p_module_name: module_name,
      p_step_ids:    stepOrder,
    });
    if (srError) throw new Error(srError.message);

    const stepMap   = new Map<string, R2Step>(r2Steps.map((s) => [s.id, s]));
    const resultMap = new Map<string, any>(
      ((srData ?? []) as any[]).map((r) => [r.test_steps_id, r])
    );

    return stepOrder
      .map((stepId): RawStepResult | null => {
        const step   = stepMap.get(stepId);
        const result = resultMap.get(stepId);
        if (!step || !result) return null;
        return {
          id:           result.id,
          status:       result.status as "pass" | "fail" | "pending",
          remarks:      result.remarks      ?? "",
          display_name: result.display_name ?? "",
          step: {
            id:                  step.id,
            serial_no:           step.serial_no,
            action:              step.action,
            expected_result:     step.expected_result,
            is_divider:          step.is_divider,
            action_image_urls:   step.action_image_urls   ?? [],
            expected_image_urls: step.expected_image_urls ?? [],
            tests_serial_no:     step.tests_serial_no,
          },
        };
      })
      .filter((r): r is RawStepResult => r !== null);
  });
}

/**
 * @deprecated Split into fetchTestExecutionContext + fetchTestExecutionStepResults.
 * Retained for backward compatibility — remove once TestExecution.tsx is migrated.
 */
export function fetchTestExecutionData(
  module_test_id: string,
  module_name:    string
): Promise<TestExecutionData> {
  return callRpc(async () => {
    const context = await fetchTestExecutionContext(module_test_id, module_name);
    const step_results = context.current_revision
      ? await fetchTestExecutionStepResults(context.current_revision.id, module_name)
      : [];
    return { ...context, step_results };
  });
}

// ── Lock check ────────────────────────────────────────────────────────────────

export function checkTestLock(module_test_id: string): Promise<LockStatus> {
  return callRpc(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const currentUserId = sessionData?.session?.user?.id;

    const { data, error } = await supabase
      .from("test_locks")
      .select("user_id, locked_by_name")
      .eq("module_test_id", module_test_id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return { status: "free" };

    if ((data as any).user_id === currentUserId) {
      return { status: "locked-by-self", holderName: (data as any).locked_by_name };
    }

    return { status: "locked-by-other", holderName: (data as any).locked_by_name };
  });
}

// ── Lock management ───────────────────────────────────────────────────────────

export function acquireLock(
  module_test_id: string,
  user_id:        string,
  display_name:   string
): Promise<{ success: boolean; holder?: string }> {
  return callRpc(async () => {
    const { data: existing } = await supabase
      .from("test_locks")
      .select("user_id, locked_by_name")
      .eq("module_test_id", module_test_id)
      .maybeSingle();

    if (existing && (existing as any).user_id !== user_id) {
      return { success: false, holder: (existing as any).locked_by_name };
    }

    if (existing && (existing as any).user_id === user_id) {
      const { error } = await supabase
        .from("test_locks")
        .update({ locked_by_name: display_name, locked_at: new Date().toISOString() })
        .eq("module_test_id", module_test_id)
        .eq("user_id", user_id);
      if (error) {
        console.error("[acquireLock] refresh error:", error.message);
        return { success: false };
      }
      return { success: true };
    }

    const { error } = await supabase.from("test_locks").insert({
      module_test_id,
      user_id,
      locked_by_name: display_name,
      locked_at:      new Date().toISOString(),
    });

    if (error) {
      const { data: winner } = await supabase
        .from("test_locks")
        .select("user_id, locked_by_name")
        .eq("module_test_id", module_test_id)
        .maybeSingle();
      const holder = (winner as any)?.locked_by_name;
      console.warn("[acquireLock] lost race to:", holder);
      return { success: false, holder };
    }

    return { success: true };
  });
}

export function releaseLock(
  module_test_id: string,
  user_id:        string
): Promise<void> {
  return callRpc(async () => {
    const { error } = await supabase
      .from("test_locks")
      .delete()
      .eq("module_test_id", module_test_id)
      .eq("user_id", user_id);
    if (error) console.error("[releaseLock]", error.message);
  });
}

export function forceReleaseLock(module_test_id: string): Promise<void> {
  return callRpc(async () => {
    const { error } = await supabase
      .from("test_locks")
      .delete()
      .eq("module_test_id", module_test_id);
    if (error) console.error("[forceReleaseLock]", error.message);
  });
}

export function heartbeatLock(
  module_test_id: string,
  user_id:        string
): Promise<void> {
  return callRpc(async () => {
    const { error } = await supabase
      .from("test_locks")
      .update({ locked_at: new Date().toISOString() })
      .eq("module_test_id", module_test_id)
      .eq("user_id", user_id);
    if (error) console.error("[heartbeatLock]", error.message);
  });
}

// ── Step results ──────────────────────────────────────────────────────────────

export function updateStepResult(payload: {
  test_steps_id: string;
  module_name:   string;
  status:        "pass" | "fail" | "pending";
  remarks:       string;
  display_name:  string;
}): Promise<void> {
  return callRpc(async () => {
    const { error } = await supabase
      .from("step_results")
      .update({
        status:       payload.status,
        remarks:      payload.remarks,
        display_name: payload.display_name,
      })
      .eq("test_steps_id", payload.test_steps_id)
      .eq("module_name",   payload.module_name);
    if (error) throw error;
  });
}

const BATCH_SIZE = 500;

export function bulkUpdateStepResults(
  batch: Array<{
    test_steps_id: string;
    module_name:   string;
    status:        "pass" | "fail" | "pending";
    remarks:       string;
    display_name:  string;
  }>
): Promise<void> {
  if (!batch.length) return Promise.resolve();
  // All rows in a batch share the same module_name (enforced by the queue
  // in TestExecution), so we pass it once as a scalar param and keep the
  // jsonb payload lean.
  const module_name = batch[0].module_name;
  return callRpc(async () => {
    const { error } = await supabase.rpc("bulk_update_step_results", {
      p_updates:     batch.map((v) => ({
        test_steps_id: v.test_steps_id,
        status:        v.status,
        remarks:       v.remarks,
        display_name:  v.display_name,
      })),
      p_module_name: module_name,
    });
    if (error) throw error;
  });
}

export function resetAllStepResults(
  module_name:   string,
  stepResultIds: string[],
  display_name:  string
): Promise<void> {
  return callRpc(async () => {
    const validIds = stepResultIds.filter(Boolean);
    if (!validIds.length) return;

    const batches = chunkArray(validIds, BATCH_SIZE);
    const results = await Promise.all(
      batches.map((batch) =>
        supabase
          .from("step_results")
          .update({ status: "pending", remarks: "", display_name })
          .in("id", batch)
      )
    );
    for (const { error } of results) {
      if (error) throw error;
    }
  });
}

// ── R2 step image URLs  (replaces Supabase fetchSignedUrls) ───────────────────

export type { StepImageUrls }

/**
 * Fetch action + expected image URLs for a batch of steps from R2.
 *
 * Cache key : ["r2StepImages", ...stepIds.sort()]
 * staleTime : 30 min  |  gcTime : 60 min
 */
export function fetchBatchStepImageUrls(
  steps: { id: string; serial_no: number }[]
): Promise<Record<string, StepImageUrls>> {
  return callRpc(async () => {
    if (!steps.length) return {};
    const token = await getWorkerToken();

    const res = await fetch("https://shrill-thunder-6fdf.rehnab-rk.workers.dev", {   // import WORKER_URL from r2.ts or redeclare
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type:  "list-batch",
        steps: steps.map(({ id, serial_no }) => ({ id, serial_no })),
      }),
    });

    if (!res.ok) throw new Error(`R2 batch image fetch failed: ${res.status}`);
    return res.json() as Promise<Record<string, StepImageUrls>>;
  });
}

/** @deprecated Use fetchBatchStepImageUrls — Supabase storage no longer used for images. */
export function fetchSignedUrls(
  _paths: string[]
): Promise<Record<string, string>> {
  console.warn("[fetchSignedUrls] deprecated — migrate to fetchBatchStepImageUrls")
  return Promise.resolve({})
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Test Report
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Session history for the current user since sessionStart.
 *
 * Cache key: ['sessionHistory', username, sessionStart]
 * staleTime: 0  |  gcTime: 5 min
 */
export function fetchSessionHistory(
  username:     string,
  sessionStart: string
): Promise<SessionHistoryEntry[]> {
  return callRpc(async () => {
    const { data, error } = await supabase
      .from("step_results")
      .select(`
        id,
        status,
        updated_at,
        display_name,
        module_name,
        test_steps:test_steps_id(
          serial_no,
          is_divider,
          tests_serial_no,
          test:tests_serial_no(name)
        )
      `)
      .eq("display_name", username)
      .gte("updated_at", sessionStart)
      .order("updated_at", { ascending: false });

    if (error) throw error;

    const rows = (data ?? []) as any[];

    const uniqueSerialNos = Array.from(
      new Set(
        rows.map((r) => r.test_steps?.tests_serial_no).filter(Boolean)
      )
    );

    const revisionMap = new Map<string, string>();
    if (uniqueSerialNos.length > 0) {
      const revisions = await getActiveRevisions(uniqueSerialNos);
      for (const [sno, rev] of Object.entries(revisions)) {
        revisionMap.set(sno, rev.revision);
      }
    }

    return rows.map((row: any) => ({
      id:              row.id,
      module_name:     row.module_name ?? "Unknown",
      tests_serial_no: row.test_steps?.tests_serial_no ?? "",
      test_name:       row.test_steps?.test?.name ?? "Untitled",
      status:          row.status,
      updated_at:      row.updated_at,
      revision:        revisionMap.get(row.test_steps?.tests_serial_no) ?? null,
      is_divider:      row.test_steps?.is_divider ?? false,
    }));
  });
}

/**
 * Module names for the filter dropdown in TestReport.
 * Source: R2 (modules/all.json).
 *
 * Cache key: ['modules']
 * staleTime: 5 min  |  gcTime: 30 min
 */
export function fetchModuleOptions(): Promise<ModuleOption[]> {
  return callRpc(async () => {
    const modules = await r2GetModules();
    return modules.map((m) => ({ name: m.name }));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Audit Log  — minimal: test_started / test_finished only
// ─────────────────────────────────────────────────────────────────────────────

const AUDIT_PAGE_SIZE = 25;

export function fetchAuditLog(page = 0): Promise<AuditLog[]> {
  return callRpc(async () => {
    const from = page * AUDIT_PAGE_SIZE;
    const to   = from + AUDIT_PAGE_SIZE - 1;

    const { data, error } = await supabase
      .from("audit_log")
      .select("id, event_type, module_name, test_name, display_name, result, created_at")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) throw new Error(error.message);
    return (data ?? []) as AuditLog[];
  });
}

export function insertTestStarted(
  module_name:  string,
  test_name:    string,
  display_name: string
): void {
  supabase
    .from("audit_log")
    .insert({ event_type: "test_started", module_name, test_name, display_name })
    .then(({ error }) => {
      if (error) console.error("[audit_log] insertTestStarted error", error);
    });
}

export function insertTestFinished(
  module_name:  string,
  test_name:    string,
  display_name: string,
  result:       "pass" | "fail" | "pending"
): void {
  supabase
    .from("audit_log")
    .insert({ event_type: "test_finished", module_name, test_name, display_name, result })
    .then(({ error }) => {
      if (error) console.error("[audit_log] insertTestFinished error", error);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Admin
// ─────────────────────────────────────────────────────────────────────────────

// ── Auth ──────────────────────────────────────────────────────────────────────

export function releaseLocksAndSignOut(
  user_id: string,
  signOut:  () => Promise<void>
): Promise<void> {
  return callRpc(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const email = session?.user?.email;

    if (email) {
      const { data, error } = await supabase
        .from("test_locks")
        .delete()
        .eq("locked_by_name", email)
        .select();
      console.log("Locks released:", data, "Error:", error);
    } else {
      console.warn("No email found in session — skipping lock release");
    }

    await signOut();
  });
}

// ── Export dump ───────────────────────────────────────────────────────────────

export const ALL_TABLES: TableName[] = [
  "profiles",
  "modules",
  "tests",
  "test_steps",
  "module_tests",
  "step_results",
  "test_locks",
  "audit_log",
];

export function fetchAllTables(): Promise<{
  data:   AllData;
  errors: string[];
}> {
  return callRpc(async () => {
    await assertAdmin();

    const data   = {} as AllData;
    const errors: string[] = [];

    await Promise.all(
      ALL_TABLES.map(async (table) => {
        const { data: rows, error } = await supabase.from(table).select("*");
        if (error) errors.push(`${table}: ${error.message}`);
        else data[table] = rows ?? [];
      })
    );

    return { data, errors };
  });
}

// ── Modules CRUD ──────────────────────────────────────────────────────────────

export function createModule(name: string): Promise<void> {
  return callRpc(async () => {
    await assertAdmin();
    const { error } = await supabase.from("modules").insert({ name });
    if (error) throw error;
  });
}

export function updateModule(oldName: string, newName: string): Promise<void> {
  return callRpc(async () => {
    await assertAdmin();
    const { error } = await supabase
      .from("modules")
      .update({ name: newName })
      .eq("name", oldName);
    if (error) throw error;
  });
}

export function deleteModule(name: string): Promise<void> {
  return callRpc(async () => {
    await assertAdmin();
    const { error } = await supabase.from("modules").delete().eq("name", name);
    if (error) throw error;
  });
}

// ── Tests CRUD ────────────────────────────────────────────────────────────────

/**
 * All tests.
 * Source: R2 (tests/all.json) — tests are static reference data.
 *
 * Cache key: ['tests']
 * staleTime: 5 min  |  gcTime: 30 min
 */
export function getTests(): Promise<TestOption[]> {
  return callRpc(async () => {
    const tests = await r2GetTests();
    return tests as TestOption[];
  });
}

export function createTest(serial_no: string, name: string): Promise<void> {
  return callRpc(async () => {
    await assertAdmin();
    const { error } = await supabase.from("tests").insert({ serial_no, name });
    if (error) throw error;
  });
}

export function updateTest(
  oldName:     string,
  newName:     string,
  newSerialNo: string
): Promise<void> {
  return callRpc(async () => {
    await assertAdmin();
    const { error } = await supabase
      .from("tests")
      .update({ serial_no: newSerialNo, name: newName })
      .eq("name", oldName);
    if (error) throw new Error(error.message);
  });
}

/**
 * Fully delete a test and all child rows in FK dependency order.
 *
 * Deletion order:
 *  1. step_results
 *  2. test_revisions
 *  3. test_steps
 *  4. module_tests
 *  5. test_locks
 *  6. tests
 */
export function deleteTestCascade(name: string): Promise<void> {
  return callRpc(async () => {
    await assertAdmin();

    const { data: testRow, error: testErr } = await supabase
      .from("tests")
      .select("serial_no")
      .eq("name", name)
      .single();
    if (testErr) throw new Error(`Test lookup failed: ${testErr.message}`);
    const serial_no = (testRow as any).serial_no as string;

    const { data: steps, error: stepsErr } = await supabase
      .from("test_steps")
      .select("id")
      .eq("tests_serial_no", serial_no);
    if (stepsErr) throw new Error(`Step fetch failed: ${stepsErr.message}`);

    const stepIds = (steps ?? []).map((s: any) => s.id);

    if (stepIds.length > 0) {
      const { error: srErr } = await supabase
        .from("step_results")
        .delete()
        .in("test_steps_id", stepIds);
      if (srErr) throw new Error(`step_results cleanup failed: ${srErr.message}`);
    }

    const deletes: Promise<{ error: any }>[] = [
      supabase.from("test_revisions").delete().eq("tests_serial_no", serial_no) as any,
      supabase.from("test_steps").delete().eq("tests_serial_no", serial_no)     as any,
      supabase.from("module_tests").delete().eq("tests_name", serial_no)        as any,
      supabase.from("test_locks").delete().eq("tests_name", serial_no)          as any,
    ];

    const results = await Promise.all(deletes);
    const labels  = ["test_revisions", "test_steps", "module_tests", "test_locks"];
    for (let i = 0; i < results.length; i++) {
      if ((results[i] as any).error) {
        throw new Error(`${labels[i]} cleanup failed: ${(results[i] as any).error.message}`);
      }
    }

    const { error } = await supabase.from("tests").delete().eq("name", name);
    if (error) throw new Error(error.message);
  });
}

// ── Steps — fetch (admin / import — reads from Supabase, not R2) ──────────────

export function fetchStepsByTest(tests_name: string): Promise<StepOption[]> {
  return callRpc(async () => {
    const { data, error } = await supabase.rpc("get_steps_by_test", {
      p_tests_name: tests_name,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as StepOption[];
  });
}

export function fetchStepOptions(tests_name: string): Promise<StepOption[]> {
  return callRpc(async () => {
    const { data: t, error: tErr } = await supabase
      .from("tests")
      .select("serial_no")
      .eq("name", tests_name)
      .single();
    if (tErr) throw new Error(tErr.message);

    const { data, error } = await supabase
      .from("test_steps")
      .select("id, serial_no, tests_serial_no, action, expected_result, is_divider")
      .eq("tests_serial_no", (t as any).serial_no)
      .order("serial_no", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as StepOption[];
  });
}

/** @deprecated Prefer fetchStepOptions — identical implementation. */
export function fetchStepsForTest(tests_name: string): Promise<StepOption[]> {
  return fetchStepOptions(tests_name);
}

export function fetchTestsForModule(module_name: string): Promise<TestOption[]> {
  return callRpc(async () => {
    const { data, error } = await supabase
      .from("module_tests")
      .select("tests_name, tests(serial_no, name)")
      .eq("module_name", module_name);
    if (error) throw new Error(error.message);

    const tests = ((data ?? []) as any[])
      .map((r) => r.tests)
      .flat()
      .filter(Boolean) as TestOption[];

    tests.sort((a, b) =>
      String(a.serial_no).localeCompare(String(b.serial_no), undefined, { numeric: true })
    );
    return tests;
  });
}

// ── Steps — import ────────────────────────────────────────────────────────────

export function findStepBySerialNo(
  tests_name: string,
  serial_no:  number
): Promise<{ id: string } | null> {
  return callRpc(async () => {
    const { data: t, error: tErr } = await supabase
      .from("tests")
      .select("serial_no")
      .eq("name", tests_name)
      .single();
    if (tErr) throw tErr;

    const { data, error } = await supabase
      .from("test_steps")
      .select("id")
      .eq("tests_serial_no", (t as any).serial_no)
      .eq("serial_no", serial_no)
      .maybeSingle();
    if (error) throw error;
    return data as { id: string } | null;
  });
}

export function bulkCreateSteps(
  tests_name: string,
  rows:       Record<string, unknown>[]
): Promise<{ written: number; errors: string[] }> {
  return callRpc(async () => {
    const { data: t, error: tErr } = await supabase
      .from("tests")
      .select("serial_no")
      .eq("name", tests_name)
      .single();
    if (tErr) return { written: 0, errors: [tErr.message] };

    const payload = rows.map((r) => ({
      ...r,
      tests_serial_no: (t as any).serial_no,
    }));

    const { error } = await supabase.from("test_steps").insert(payload);
    if (error) return { written: 0, errors: [error.message] };
    return { written: rows.length, errors: [] };
  });
}

// ── Steps — Manual CRUD ───────────────────────────────────────────────────────

export function createStep(payload: ManualStepPayload): Promise<void> {
  return callRpc(async () => {
    await assertAdmin();
    const { error } = await supabase.from("test_steps").insert(payload);
    if (error) throw error;
  });
}

/** @deprecated test_steps rows are append-only per schema invariant. */
export function updateStep(
  id:    string,
  patch: { action: string; expected_result: string; is_divider: boolean }
): Promise<void> {
  return callRpc(async () => {
    await assertAdmin();
    const { error } = await supabase.from("test_steps").update(patch).eq("id", id);
    if (error) throw error;
  });
}

/** @deprecated test_steps rows must never be deleted per schema invariant. */
export function deleteStep(id: string): Promise<void> {
  return callRpc(async () => {
    await assertAdmin();
    const { error } = await supabase.from("test_steps").delete().eq("id", id);
    if (error) throw error;
  });
}

/** @deprecated See deleteStep. */
export function deleteStepWithResults(id: string): Promise<void> {
  return callRpc(async () => {
    await assertAdmin();
    const { error: resErr } = await supabase
      .from("step_results")
      .delete()
      .eq("test_steps_id", id);
    if (resErr) throw new Error(`Result cleanup failed: ${resErr.message}`);

    const { error } = await supabase.from("test_steps").delete().eq("id", id);
    if (error) throw new Error(error.message);
  });
}

/** @deprecated Use the revision-based import flow instead. */
export function replaceCsvSteps(
  tests_name: string,
  rows:       CsvStepRow[]
): Promise<void> {
  return callRpc(async () => {
    await assertAdmin();

    const { data: t, error: tErr } = await supabase
      .from("tests")
      .select("serial_no")
      .eq("name", tests_name)
      .single();
    if (tErr) throw new Error(tErr.message);

    const { error: delErr } = await supabase
      .from("test_steps")
      .delete()
      .eq("tests_serial_no", (t as any).serial_no);
    if (delErr) throw delErr;

    if (rows.length === 0) return;

    const { error: insErr } = await supabase.from("test_steps").insert(rows);
    if (insErr) throw insErr;
  });
}