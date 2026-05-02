/**
 * src/lib/rpc.ts
 *
 * Single import surface for all Supabase queries and mutations.
 * Components import ONLY from this file — never from supabase directly.
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

// ═════════════════════════════════════════════════════════════════════════════
// Session Expired Signal  (merged from rpc.interceptor.ts)
// ═════════════════════════════════════════════════════════════════════════════
// A lightweight pub/sub used to notify the UI when a session is unrecoverable.
// Any component (or the AppShell) subscribes and shows the re-auth modal.
//
// Using a plain EventTarget keeps this zero-dependency and framework-agnostic.
// Alternatively replace with a Zustand atom: `sessionExpiredStore.setState(true)`.

type SessionExpiredListener = () => void;

class SessionExpiredSignal {
  private listeners = new Set<SessionExpiredListener>();

  /** Subscribe. Returns an unsubscribe function. */
  subscribe(fn: SessionExpiredListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Called by callRpc when the refresh token is expired / invalid. */
  emit(): void {
    this.listeners.forEach((fn) => fn());
  }
}

export const sessionExpiredSignal = new SessionExpiredSignal();

// ═════════════════════════════════════════════════════════════════════════════
// callRpc — global 401 interceptor
// ═════════════════════════════════════════════════════════════════════════════
//
// Wraps every RPC call. On a 401 / PGRST301 response it:
//   1. Attempts a silent session refresh (Supabase rotates the JWT in place).
//   2. If refresh succeeds → retries the original call exactly once.
//   3. If refresh fails (token truly expired / revoked) → emits
//      sessionExpiredSignal so the UI can show the re-auth modal.
//
// The caller (useQuery / useMutation) never sees a raw 401 — either the
// retry succeeds transparently, or the modal intercepts the session.
//
// TanStack Query is configured with `retry: false` for 401 (queryClient.ts)
// so it never races with this interceptor.

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

    // ── Attempt a silent JWT refresh ──────────────────────────────────────
    const { error: refreshError } = await supabase.auth.refreshSession();

    if (refreshError) {
      // Refresh token is expired / revoked — session is unrecoverable.
      // Emit signal so the AppShell shows the re-auth modal.
      sessionExpiredSignal.emit();
      throw err; // surface original error for TanStack error state
    }

    // ── Retry original call once with fresh JWT ───────────────────────────
    // If this also throws, it propagates normally — no infinite loop.
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
  step_order:      string[];
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

export type TestExecutionData = {
  module_name:       string;
  is_visible:        boolean;
  current_revision:  ActiveRevision | null;
  active_revisions:  Record<string, ActiveRevision>;
  module_tests:      RawModuleTestItem[];
  step_results:      RawStepResult[];
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
 * Shared between ModuleDashboard and TestExecution (sidebar).
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
 * Shared between ModuleDashboard, TestExecution, and TestReport.
 *
 * Pass includeStepOrder = true from ModuleDashboard (needs step_order).
 * TestExecution and TestReport pass false.
 *
 * Cache key: ['activeRevisions', ...serialNos.sort()]
 * staleTime: 5 min  |  gcTime: 30 min
 */
export function getActiveRevisions(
  serialNos: string[],
  includeStepOrder = false
): Promise<Record<string, ActiveRevision>> {
  return callRpc(async () => {
    if (!serialNos.length) return {};

    const select = includeStepOrder
      ? "id, revision, tests_serial_no, step_order"
      : "id, revision, tests_serial_no";

    const { data, error } = await supabase
      .from("test_revisions")
      .select(select)
      .eq("status", "active")
      .in("tests_serial_no", serialNos);

    if (error) throw new Error(error.message);

    return Object.fromEntries(
      ((data ?? []) as any[]).map((r) => [
        r.tests_serial_no,
        {
          id:              r.id,
          revision:        r.revision,
          tests_serial_no: r.tests_serial_no,
          step_order:      Array.isArray(r.step_order) ? r.step_order : [],
        } satisfies ActiveRevision,
      ])
    );
  });
}

/**
 * All locks for the given module_test_ids.
 * Shared between ModuleDashboard and TestExecution.
 * Realtime subscription invalidates ['moduleLocks', module_name] on change.
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

// Internal — shape returned by get_dashboard_counts RPC
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
 * Two parallel queries — RPC + modules table.
 *
 * Cache key: ['dashboardSummaries']
 * staleTime: 30s  |  gcTime: 10 min
 */
export function fetchDashboardSummaries(): Promise<DashboardModuleSummary[]> {
  return callRpc(async () => {
    const [countsResult, modulesResult] = await Promise.all([
      supabase.rpc("get_dashboard_counts"),
      supabase.from("modules").select("name, description").order("name"),
    ]);

    if (countsResult.error) throw new Error(countsResult.error.message);
    if (modulesResult.error) throw new Error(modulesResult.error.message);

    const countMap = new Map<string, RpcDashboardCountRow>();
    for (const row of (countsResult.data ?? []) as RpcDashboardCountRow[]) {
      countMap.set(row.module_name, row);
    }

    return ((modulesResult.data ?? []) as any[]).map((mod): DashboardModuleSummary => {
      const cnt = countMap.get(mod.name as string);
      return {
        name:        mod.name        as string,
        description: (mod.description as string | null) ?? null,
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

// Internal — shape returned by get_module_counts RPC
type RpcModuleCountRow = {
  tests_serial_no: string;
  pass_count:      number;
  fail_count:      number;
  pending_count:   number;
  total_count:     number;
};

/**
 * All data for ModuleDashboard in two round-trips.
 *
 * Round 1 (parallel): module_counts RPC + module_tests list
 * Round 2 (parallel, uses serialNos from round 1):
 *   active revisions SCOPED to this module's tests + locks for this module
 *
 * Bug fixed: revision fetch was previously unfiltered (all active revisions
 * across the entire database). Now scoped to serialNos of this module only.
 *
 * Cache key: compose from ['moduleTests', name] + ['moduleCounts', name] +
 *            ['activeRevisions', ...sns] + ['moduleLocks', name]
 */
export function fetchModuleData(module_name: string): Promise<ModuleData> {
  return callRpc(async () => {
    // ── Round 1: parallel ──────────────────────────────────────────────────────
    const [countsResult, testsResult] = await Promise.all([
      supabase.rpc("get_module_counts", { p_module_name: module_name }),
      supabase
        .from("module_tests")
        .select(
          "id, tests_name, is_visible, test:tests!module_tests_tests_name_fkey(serial_no, name)"
        )
        .eq("module_name", module_name),
    ]);

    if (countsResult.error) throw new Error(countsResult.error.message);
    if (testsResult.error)  throw new Error(testsResult.error.message);

    const rawTests    = (testsResult.data ?? []) as any[];
    const moduleTestIds: string[] = rawTests.map((mt) => mt.id as string);
    const serialNos:     string[] = rawTests
      .map((mt) => mt.test?.serial_no as string | undefined)
      .filter((s): s is string => !!s);

    // ── Round 2: parallel, now that we have the IDs ────────────────────────────
    const [revisionsResult, locksResult] = await Promise.all([
      serialNos.length > 0
        ? supabase
            .from("test_revisions")
            .select("id, revision, tests_serial_no, step_order")
            .eq("status", "active")
            .in("tests_serial_no", serialNos)   // ← scoped to this module's tests
        : Promise.resolve({ data: [] as any[], error: null }),
      moduleTestIds.length > 0
        ? supabase
            .from("test_locks")
            .select("module_test_id, user_id, locked_by_name, locked_at")
            .in("module_test_id", moduleTestIds)
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);

    if (revisionsResult.error) throw new Error(revisionsResult.error.message);
    if (locksResult.error)     throw new Error(locksResult.error.message);

    // ── Count map ──────────────────────────────────────────────────────────────
    const countMap = new Map<string, RpcModuleCountRow>();
    for (const row of (countsResult.data ?? []) as RpcModuleCountRow[]) {
      countMap.set(row.tests_serial_no, row);
    }

    // ── Revision map ───────────────────────────────────────────────────────────
    const revisions: Record<string, ActiveRevision> = {};
    for (const r of (revisionsResult.data ?? []) as any[]) {
      revisions[r.tests_serial_no] = {
        id:              r.id,
        revision:        r.revision,
        tests_serial_no: r.tests_serial_no,
        step_order:      Array.isArray(r.step_order) ? r.step_order : [],
      };
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
 * Prefer invalidating ['moduleLocks', module_name] via TanStack Query instead.
 */
export function fetchModuleLocks(
  moduleTestIds: string[]
): Promise<Record<string, LockRow>> {
  return callRpc(async () => getModuleLocks(moduleTestIds));
}

/**
 * Full step-result rows for CSV / PDF export.
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

// Internal — shape returned by get_test_execution RPC
type RpcStepRow = {
  step_id:             string;
  ord_idx:             number;
  serial_no:           number;
  is_divider:          boolean;
  action:              string;
  expected_result:     string;
  action_image_urls:   string[] | null;
  expected_image_urls: string[] | null;
  tests_serial_no:     string;
  result_id:           string;
  status:              string;
  remarks:             string;
  display_name:        string;
  is_visible:          boolean;
  revision_id:         string | null;
  revision_label:      string | null;
  revision_serial_no:  string | null;
};

/**
 * All data for TestExecution in two round-trips.
 *
 * Round 1 (parallel):
 *   - get_test_execution RPC — steps + results joined in Postgres
 *   - module_tests for the sidebar
 *
 * Round 2 (sequential, needs serialNos from round 1):
 *   - active revisions for nav badges
 *   - Current test's revision is seeded from row[0] scalar — NOT re-fetched.
 *
 * Bug fixed: removed deprecated fetchTestExecution alias that passed an empty
 * module_name default, silently producing wrong step_results from the RPC.
 * Both params are now required.
 *
 * Bug fixed: Round 2 excludes the current test's serial_no (already in hand
 * from row[0]) to avoid a redundant refetch.
 *
 * Cache key: ['executionContext', module_test_id]
 * staleTime: 0  |  gcTime: 10 min
 */
export function fetchTestExecutionData(
  module_test_id: string,
  module_name:    string    // required — no default, empty string produces wrong RPC results
): Promise<TestExecutionData> {
  return callRpc(async () => {
    // ── Round 1: parallel ──────────────────────────────────────────────────────
    const [stepsRes, allMtRes] = await Promise.all([
      supabase.rpc("get_test_execution", {
        p_module_test_id: module_test_id,
        p_module_name:    module_name,
      }),
      supabase
        .from("module_tests")
        .select(
          "id, tests_name, is_visible, test:tests!module_tests_tests_name_fkey(serial_no, name)"
        )
        .eq("module_name", module_name)
        .order("tests_name"),
    ]);

    if (stepsRes.error) throw new Error(stepsRes.error.message);
    if (allMtRes.error) throw new Error(allMtRes.error.message);

    const rows  = (stepsRes.data ?? []) as RpcStepRow[];
    const first = rows[0] ?? null;

    // ── Scalar metadata from row[0] ────────────────────────────────────────────
    const is_visible: boolean = first?.is_visible ?? true;

    const current_revision: ActiveRevision | null = first?.revision_id
      ? {
          id:              first.revision_id,
          revision:        first.revision_label     ?? "",
          tests_serial_no: first.revision_serial_no ?? "",
          step_order:      [],
        }
      : null;

    // ── Build RawStepResult[] ──────────────────────────────────────────────────
    const step_results: RawStepResult[] = rows.map((r) => ({
      id:           r.result_id,
      status:       r.status as "pass" | "fail" | "pending",
      remarks:      r.remarks,
      display_name: r.display_name,
      step: {
        id:                  r.step_id,
        serial_no:           r.serial_no,
        action:              r.action,
        expected_result:     r.expected_result,
        is_divider:          r.is_divider,
        action_image_urls:   r.action_image_urls   ?? [],
        expected_image_urls: r.expected_image_urls ?? [],
        tests_serial_no:     r.tests_serial_no,
      },
    }));

    // ── module_tests & serialNos ───────────────────────────────────────────────
    const module_tests = (allMtRes.data ?? []) as unknown as RawModuleTestItem[];

    // Exclude current test's serial_no — already seeded from row[0], no refetch needed
    const currentSerialNo = current_revision?.tests_serial_no;
    const serialNos: string[] = module_tests
      .map((mt) => (mt as any).test?.serial_no as string | undefined)
      .filter((s): s is string => !!s && s !== currentSerialNo);

    // ── Round 2: remaining revisions for nav badges ────────────────────────────
    const active_revisions: Record<string, ActiveRevision> = {};

    if (current_revision) {
      active_revisions[current_revision.tests_serial_no] = current_revision;
    }

    if (serialNos.length > 0) {
      const { data: revData } = await supabase
        .from("test_revisions")
        .select("id, revision, tests_serial_no")
        .eq("status", "active")
        .in("tests_serial_no", serialNos);

      for (const r of (revData ?? []) as any[]) {
        active_revisions[r.tests_serial_no] = {
          id:              r.id,
          revision:        r.revision,
          tests_serial_no: r.tests_serial_no,
          step_order:      [],
        };
      }
    }

    return {
      module_name,
      is_visible,
      current_revision,
      active_revisions,
      module_tests,
      step_results,
    };
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

/**
 * Refreshes locked_at to prevent server-side lock expiry.
 * Called every 60s while a lock is held.
 */
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

/**
 * Update an existing step result row.
 * Rows are pre-seeded at test initialisation — this is UPDATE only.
 * If the row doesn't exist, the update silently affects 0 rows; that is a
 * schema invariant violation, not a silent success.
 *
 * Renamed from upsertStepResult — there is no insert path in the tester flow.
 */
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

// ── Signed image URLs ─────────────────────────────────────────────────────────

export function fetchSignedUrls(
  paths: string[]
): Promise<Record<string, string>> {
  return callRpc(async () => {
    const unique = Array.from(new Set(paths.filter(Boolean)));
    if (!unique.length) return {};

    const batches  = chunkArray(unique, 500);
    const allEntries: [string, string][] = [];

    for (const batch of batches) {
      const { data, error } = await supabase.storage
        .from("test_steps")
        .createSignedUrls(batch, 3600);
      if (error || !data) continue;
      for (const entry of data) {
        if (entry.signedUrl) allEntries.push([entry.path!, entry.signedUrl]);
      }
    }

    return Object.fromEntries(allEntries);
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// 7. Test Report
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Session history for the current user since sessionStart.
 * Two round-trips: step_results + active revisions for unique tests.
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
 *
 * Cache key: ['modules']
 * staleTime: 5 min  |  gcTime: 30 min
 */
export function fetchModuleOptions(): Promise<ModuleOption[]> {
  return callRpc(async () => {
    const { data, error } = await supabase
      .from("modules")
      .select("name")
      .order("name");
    if (error) throw error;
    return (data ?? []) as ModuleOption[];
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// 8. Audit Log  — minimal: test_started / test_finished only
// ─────────────────────────────────────────────────────────────────────────────

const AUDIT_PAGE_SIZE = 25;

/**
 * Paginated audit log. Page 0 = newest entries.
 *
 * Cache key: ['auditLog', page]
 * staleTime: 30s  |  gcTime: 10 min
 */
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

/**
 * Fire-and-forget — logged when a tester opens a test for execution.
 * NOT wrapped with callRpc — swallows its own errors and a 401 here is harmless.
 */
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

/**
 * Fire-and-forget — logged when a tester submits / closes a test.
 * result reflects the overall outcome at the time of finishing.
 * NOT wrapped with callRpc — swallows its own errors and a 401 here is harmless.
 */
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

/**
 * Releases all locks held by user_id then calls signOut.
 * locked_by_name stores email, not UUID.
 */
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
 * All tests — used by the import modal and admin test management.
 *
 * Cache key: ['tests']
 * staleTime: 5 min  |  gcTime: 30 min
 */
export function getTests(): Promise<TestOption[]> {
  return callRpc(async () => {
    const { data, error } = await supabase
      .from("tests")
      .select("serial_no, name")
      .order("serial_no");
    if (error) throw error;
    return (data ?? []) as TestOption[];
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
 *  1. step_results       (FK → test_steps.id)
 *  2. test_revisions     (FK → tests.serial_no)
 *  3. test_steps         (FK → tests.serial_no)
 *  4. module_tests       (FK → tests.serial_no via tests_name)
 *  5. test_locks         (FK → tests.serial_no via tests_name)
 *  6. tests
 *
 * Note: steps 4 and 5 use the column name that matches the actual FK in the
 * schema. Verify `module_tests.tests_name` and `test_locks.tests_name` store
 * the serial_no value — this was introduced during the text-PK migration.
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

// ── Steps — fetch ─────────────────────────────────────────────────────────────

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

export function fetchTestsForModule(module_name: string): Promise<TestOption[]> {
  return callRpc(async () => {
    const { data, error } = await supabase
      .from("module_tests")
      .select("test_name, tests(serial_no, name)")
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

export function fetchStepsForTest(tests_name: string): Promise<StepOption[]> {
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
