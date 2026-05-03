/**
 * src/lib/hooks.ts
 *
 * TanStack Query hooks — single import surface for all data access.
 * Components import ONLY from this file; never from rpc.ts or queryClient.ts directly.
 *
 * Sections:
 *   1.  Realtime helpers
 *   2.  Dashboard
 *   3.  Module Dashboard
 *   4.  Test Execution  — queries + lock mutations + step-result mutations
 *   5.  Test Report
 *   6.  Audit Log
 *   7.  Admin           — tables, modules, tests, steps
 */

import { useMemo } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { queryClient, QK, STALE, GC } from "./queryClient";
import {
  // Dashboard
  fetchDashboardSummaries,
  fetchActiveLocks,
  fetchOtherActiveLockModules,
  // Module Dashboard
  fetchModuleData,
  fetchModuleLocks,
  fetchModuleStepDetails,
  getModuleTests,
  getModuleLocks,
  getActiveRevisions,
  // Test Execution
  fetchTestExecutionData,
  acquireLock,
  releaseLock,
  forceReleaseLock,
  heartbeatLock,
  updateStepResult,
  resetAllStepResults,
  // Test Report
  fetchSessionHistory,
  fetchModuleOptions,
  // Audit Log
  fetchAuditLog,
  insertTestStarted,
  insertTestFinished,
  // Admin
  fetchAllTables,
  getTests,
  createModule,
  updateModule,
  deleteModule,
  createTest,
  updateTest,
  deleteTestCascade,
  fetchStepOptions,
  fetchStepsByTest,
  fetchStepsForTest,
  fetchTestsForModule,
  findStepBySerialNo,
  bulkCreateSteps,
  createStep,
  updateStep,
  deleteStep,
  deleteStepWithResults,
  replaceCsvSteps,
  releaseLocksAndSignOut,
  fetchBatchStepImageUrls,
  // Types (re-export so callers only need one import)
  type DashboardModuleSummary,
  type ActiveLock,
  type ModuleData,
  type ModuleTestRow,
  type TrimmedStepResult,
  type TestExecutionData,
  type RawStepResult,
  type RawModuleTestItem,
  type SessionHistoryEntry,
  type SessionGroup,
  type AuditLog,
  type ModuleOption,
  type TestOption,
  type StepOption,
  type ManualStepPayload,
  type CsvStepRow,
  type AllData,
  type LockRow,
  type ActiveRevision,
  type ModuleTestItem,
  type TableName,
  type StepImageUrls,
} from "./rpc";

// Re-export all types so consumers only need: `import { … } from "~/lib/hooks"`
export type {
  DashboardModuleSummary,
  ActiveLock,
  ModuleData,
  ModuleTestRow,
  TrimmedStepResult,
  TestExecutionData,
  RawStepResult,
  RawModuleTestItem,
  SessionHistoryEntry,
  SessionGroup,
  AuditLog,
  ModuleOption,
  TestOption,
  StepOption,
  ManualStepPayload,
  CsvStepRow,
  AllData,
  LockRow,
  ActiveRevision,
  ModuleTestItem,
  TableName,
  StepImageUrls,
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. Realtime helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Call from a Realtime subscription handler to refresh lock state for a
 * module without a full context reload.
 */
export function invalidateModuleLocks(module_name: string): void {
  queryClient.invalidateQueries({ queryKey: QK.moduleLocks(module_name) });
}

// invalidateExecutionContext intentionally removed:
// TestExecution initialises local state once from the query cache and then
// manages it optimistically. The executionContext query is never re-consumed
// after mount, so invalidating it is wasted bandwidth and a discarded render.

/** Flush all cached data — call on sign-out. */
export function clearQueryCache(): void {
  queryClient.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Dashboard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All modules with aggregated pass/fail/pending counts.
 *
 * Backed by `get_dashboard_counts` RPC + `modules` table.
 * Realtime: invalidate QK.dashboardSummaries() on any step_result change.
 */
export function useDashboardSummaries(
  options?: Partial<UseQueryOptions<DashboardModuleSummary[]>>
) {
  return useQuery<DashboardModuleSummary[]>({
    queryKey:  QK.dashboardSummaries(),
    queryFn:   fetchDashboardSummaries,
    staleTime: STALE.dashboard,
    gcTime:    GC.dashboard,
    ...options,
  });
}

/**
 * Locks held by the currently authenticated user.
 * staleTime: 0 — Realtime is source of truth; cache is always considered stale.
 */
export function useActiveLocks(
  options?: Partial<UseQueryOptions<ActiveLock[]>>
) {
  return useQuery<ActiveLock[]>({
    queryKey:  QK.activeLocks(),
    queryFn:   fetchActiveLocks,
    staleTime: STALE.locks,
    gcTime:    GC.locks,
    ...options,
  });
}

/**
 * Count of other users' active locks keyed by module name.
 * Used to show the "N Locked" badge on Dashboard module cards.
 */
export function useOtherActiveLocks(
  options?: Partial<UseQueryOptions<Map<string, number>>>
) {
  return useQuery<Map<string, number>>({
    queryKey:  QK.otherActiveLocks(),
    queryFn:   fetchOtherActiveLockModules,
    staleTime: STALE.locks,
    gcTime:    GC.locks,
    ...options,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Module Dashboard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All data needed by ModuleDashboard in two round-trips.
 * Disabled when module_name is empty (route not yet resolved).
 */
export function useModuleData(
  module_name: string,
  options?: Partial<UseQueryOptions<ModuleData>>
) {
  return useQuery<ModuleData>({
    queryKey:             QK.moduleCounts(module_name),
    queryFn:              () => fetchModuleData(module_name),
    enabled:              !!module_name,
    staleTime:            STALE.moduleTests,  // invalidated explicitly by step mutations
    gcTime:               GC.moduleTests,
    refetchOnWindowFocus: false,
    ...options,
  });
}

/**
 * Lightweight lock-only refresh — called from a Realtime subscription.
 * Prefer invalidating QK.moduleLocks(module_name) via invalidateModuleLocks().
 */
export function useModuleLocks(
  moduleTestIds: string[],
  module_name:   string,
  options?: Partial<UseQueryOptions<Record<string, LockRow>>>
) {
  return useQuery<Record<string, LockRow>>({
    queryKey:  QK.moduleLocks(module_name),
    queryFn:   () => getModuleLocks(moduleTestIds),
    enabled:   moduleTestIds.length > 0,
    staleTime: STALE.locks,
    gcTime:    GC.locks,
    ...options,
  });
}

/**
 * Full step-result rows for CSV / PDF export.
 * Fetched lazily — only when the user opens the export modal.
 * Pass `enabled: false` until the modal opens, then flip to true.
 */
export function useModuleStepDetails(
  module_name: string,
  options?: Partial<UseQueryOptions<Record<string, TrimmedStepResult[]>>>
) {
  return useQuery<Record<string, TrimmedStepResult[]>>({
    queryKey:  QK.moduleStepDetails(module_name),
    queryFn:   () => fetchModuleStepDetails(module_name),
    enabled:   !!module_name,
    staleTime: STALE.locks,   // treat as always-stale — export must be fresh
    gcTime:    GC.locks,
    ...options,
  });
}

/**
 * Bare test list for a module (no counts).
 * Shared between ModuleDashboard sidebar and TestExecution nav.
 */
export function useModuleTests(
  module_name: string,
  options?: Partial<UseQueryOptions<ModuleTestItem[]>>
) {
  return useQuery<ModuleTestItem[]>({
    queryKey:  QK.moduleTests(module_name),
    queryFn:   () => getModuleTests(module_name),
    enabled:   !!module_name,
    staleTime: STALE.moduleTests,
    gcTime:    GC.moduleTests,
    ...options,
  });
}

/**
 * Active revision map for a set of test serial numbers.
 * Pass includeStepOrder=true from ModuleDashboard (needs step_order for sorting).
 */
export function useActiveRevisions(
  serialNos:        string[],
  includeStepOrder  = false,
  options?: Partial<UseQueryOptions<Record<string, ActiveRevision>>>
) {
  const sorted = [...serialNos].sort();
  return useQuery<Record<string, ActiveRevision>>({
    queryKey:             QK.activeRevisions(sorted),
    queryFn:              () => getActiveRevisions(sorted, includeStepOrder),
    enabled:              sorted.length > 0,
    staleTime:            Infinity,  // revisions only change on admin action
    gcTime:               GC.moduleTests,
    refetchOnWindowFocus: false,
    ...options,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Test Execution
// ─────────────────────────────────────────────────────────────────────────────

// ── Context query ─────────────────────────────────────────────────────────────

/**
 * All data for the TestExecution view.
 * Disabled when either param is empty — prevents the wrong RPC call that
 * silently returns results for a different module.
 *
 * Additionally gated externally: callers pass `enabled: false` until the lock
 * check resolves, ensuring the heavy execution fetch never runs when another
 * user already holds the lock.
 */
export function useTestExecutionData(
  module_test_id: string,
  module_name:    string,
  options?: Partial<UseQueryOptions<TestExecutionData>>
) {
  return useQuery<TestExecutionData>({
    queryKey:            QK.executionContext(module_test_id),
    queryFn:             () => fetchTestExecutionData(module_test_id, module_name),
    enabled:             !!module_test_id && !!module_name,
    staleTime:           STALE.execution,   // optimistic after first load — never refetch
    gcTime:              GC.execution,
    refetchOnWindowFocus: false,     // override global — remount must not re-fetch
    ...options,
  });
}

// ── Signed image URLs ─────────────────────────────────────────────────────────

/**
 * Signed storage URLs for step images.
 * Cached for 50 min (URLs are valid for 60 min, leaving a 10 min buffer).
 */
/**
 * R2 image URLs for a batch of steps, split into action / expected sets.
 *
 * Pass the non-divider steps from stepResults — the hook is a no-op when
 * the array is empty (no revision loaded yet).
 *
 * Stable cache key derived from sorted step IDs so adding/removing a single
 * step only busts the right cache entry.
 */
export function useStepImageUrls(
  steps:   { id: string; serial_no: number }[],
  options?: Partial<UseQueryOptions<Record<string, StepImageUrls>>>
) {
  // Stable key — sort so order in stepResults doesn't matter
  const key = useMemo(
    () => [...steps].sort((a, b) => a.id.localeCompare(b.id)).map(s => s.id).join(","),
    [steps]
  )

  return useQuery<Record<string, StepImageUrls>>({
    queryKey:  ["r2StepImages", key],
    queryFn:   () => fetchBatchStepImageUrls(steps),
    enabled:   steps.length > 0,
    staleTime: 30 * 60 * 1000,   // 30 min — images don't change during a session
    gcTime:    60 * 60 * 1000,
    ...options,
  })
}

/** @deprecated Migrate to useStepImageUrls. */
export function useSignedUrls(
  paths:   string[],
  options?: Partial<UseQueryOptions<Record<string, string>>>
) {
  console.warn("[useSignedUrls] deprecated")
  return useQuery<Record<string, string>>({
    queryKey: ["signedUrls_deprecated"],
    queryFn:  () => Promise.resolve({}),
    enabled:  false,
    ...options,
  })
}

// ── Lock mutations ────────────────────────────────────────────────────────────

type AcquireLockVars = {
  module_test_id: string;
  user_id:        string;
  display_name:   string;
};

/**
 * Acquire a test lock. On success invalidates active locks so the Dashboard
 * badge and ModuleDashboard lock indicators update immediately.
 */
export function useAcquireLock(
  options?: UseMutationOptions<{ success: boolean; holder?: string }, Error, AcquireLockVars>
) {
  const qc = useQueryClient();
  return useMutation<{ success: boolean; holder?: string }, Error, AcquireLockVars>({
    mutationFn: ({ module_test_id, user_id, display_name }) =>
      acquireLock(module_test_id, user_id, display_name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.activeLocks() });
      qc.invalidateQueries({ queryKey: QK.otherActiveLocks() });
    },
    ...options,
  });
}

type LockVars = { module_test_id: string; user_id: string };

/**
 * Release the caller's lock. Invalidates lock-related queries and the
 * dashboard summary (lock badge).
 */
export function useReleaseLock(
  module_name: string,
  options?: UseMutationOptions<void, Error, LockVars>
) {
  const qc = useQueryClient();
  return useMutation<void, Error, LockVars>({
    mutationFn: ({ module_test_id, user_id }) => releaseLock(module_test_id, user_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.activeLocks() });
      qc.invalidateQueries({ queryKey: QK.otherActiveLocks() });
      if (module_name) {
        qc.invalidateQueries({ queryKey: QK.moduleLocks(module_name) });
      }
    },
    ...options,
  });
}

/**
 * Admin-only force release (removes another user's lock).
 * Invalidates module lock state and dashboard badge.
 */
export function useForceReleaseLock(
  module_name?: string,
  options?: UseMutationOptions<void, Error, { module_test_id: string }>
) {
  const qc = useQueryClient();
  return useMutation<void, Error, { module_test_id: string }>({
    mutationFn: ({ module_test_id }) => forceReleaseLock(module_test_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.activeLocks() });
      qc.invalidateQueries({ queryKey: QK.otherActiveLocks() });
      if (module_name) {
        qc.invalidateQueries({ queryKey: QK.moduleLocks(module_name) });
      }
    },
    ...options,
  });
}

/**
 * Heartbeat — refreshes locked_at to prevent server-side expiry.
 * Fire every 60 s while a lock is held. No cache invalidation needed.
 */
export function useHeartbeatLock(
  options?: UseMutationOptions<void, Error, LockVars>
) {
  return useMutation<void, Error, LockVars>({
    mutationFn: ({ module_test_id, user_id }) => heartbeatLock(module_test_id, user_id),
    ...options,
  });
}

// ── Step result mutations ─────────────────────────────────────────────────────

type UpdateStepResultVars = {
  test_steps_id: string;
  module_name:   string;
  status:        "pass" | "fail" | "pending";
  remarks:       string;
  display_name:  string;
};

/**
 * Save a single step result.
 *
 * Invalidates:
 *  - dashboardSummaries / moduleCounts — so pass/fail bars update after submit
 *
 * executionContext is intentionally NOT invalidated: TestExecution initialises
 * local state once and manages it optimistically. A refetch would be discarded
 * by the hasInitializedForRef guard — pure wasted bandwidth.
 */
export function useUpdateStepResult(
  module_test_id: string,
  module_name:    string,
  options?: UseMutationOptions<void, Error, UpdateStepResultVars>
) {
  const qc = useQueryClient();
  return useMutation<void, Error, UpdateStepResultVars>({
    mutationFn: updateStepResult,
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: QK.dashboardSummaries() });
      qc.invalidateQueries({ queryKey: QK.moduleCounts(module_name) });
    },
    ...options,
  });
}

type ResetStepResultsVars = {
  module_name:   string;
  stepResultIds: string[];
  display_name:  string;
};

/**
 * Reset all step results for a test back to pending.
 * Invalidates aggregate counts only — same rationale as useUpdateStepResult.
 */
export function useResetAllStepResults(
  module_test_id: string,
  options?: UseMutationOptions<void, Error, ResetStepResultsVars>
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ResetStepResultsVars>({
    mutationFn: ({ module_name, stepResultIds, display_name }) =>
      resetAllStepResults(module_name, stepResultIds, display_name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.dashboardSummaries() });
    },
    ...options,
  });
}

// ── Sign-out ──────────────────────────────────────────────────────────────────

/**
 * Release all locks held by user_id then sign out, clearing the query cache.
 */
export function useReleaseLocksAndSignOut(
  options?: UseMutationOptions<
    void,
    Error,
    { user_id: string; signOut: () => Promise<void> }
  >
) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { user_id: string; signOut: () => Promise<void> }
  >({
    mutationFn: ({ user_id, signOut }) => releaseLocksAndSignOut(user_id, signOut),
    onSuccess:  () => qc.clear(),
    ...options,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Test Report
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Step results touched by `username` since `sessionStart`.
 * staleTime: 0 — always refetch; the tester may have just submitted a result.
 */
export function useSessionHistory(
  username:     string,
  sessionStart: string,
  options?: Partial<UseQueryOptions<SessionHistoryEntry[]>>
) {
  return useQuery<SessionHistoryEntry[]>({
    queryKey:  QK.sessionHistory(username, sessionStart),
    queryFn:   () => fetchSessionHistory(username, sessionStart),
    enabled:   !!username && !!sessionStart,
    staleTime: STALE.sessionHistory,
    gcTime:    GC.sessionHistory,
    ...options,
  });
}

/**
 * Module name list for the TestReport filter dropdown.
 */
export function useModuleOptions(
  options?: Partial<UseQueryOptions<ModuleOption[]>>
) {
  return useQuery<ModuleOption[]>({
    queryKey:  QK.moduleOptions(),
    queryFn:   fetchModuleOptions,
    staleTime: STALE.modules,
    gcTime:    GC.modules,
    ...options,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Audit Log
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Paginated audit log. Page 0 = newest.
 * Pass `page` as a reactive value; TanStack Query handles the key change.
 */
export function useAuditLog(
  page    = 0,
  options?: Partial<UseQueryOptions<AuditLog[]>>
) {
  return useQuery<AuditLog[]>({
    queryKey:  QK.auditLog(page),
    queryFn:   () => fetchAuditLog(page),
    staleTime: STALE.auditLog,
    gcTime:    GC.auditLog,
    ...options,
  });
}

/**
 * Fire-and-forget audit insertion. Not a mutation — has no loading/error state.
 * Call directly; TanStack Query is not involved.
 */
export { insertTestStarted, insertTestFinished };

// ─────────────────────────────────────────────────────────────────────────────
// 7. Admin
// ─────────────────────────────────────────────────────────────────────────────

// ── Full dump ─────────────────────────────────────────────────────────────────

/**
 * Full data dump across all eight tables.
 * Enabled only for admins; the RPC enforces this server-side as well.
 */
export function useAllTables(
  options?: Partial<UseQueryOptions<{ data: AllData; errors: string[] }>>
) {
  return useQuery<{ data: AllData; errors: string[] }>({
    queryKey:  QK.allTables(),
    queryFn:   fetchAllTables,
    staleTime: STALE.admin,
    gcTime:    GC.admin,
    ...options,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/** All tests — used by import modal and test management. */
export function useTests(
  options?: Partial<UseQueryOptions<TestOption[]>>
) {
  return useQuery<TestOption[]>({
    queryKey:  QK.tests(),
    queryFn:   getTests,
    staleTime: STALE.modules,
    gcTime:    GC.modules,
    ...options,
  });
}

/** All tests belonging to a specific module. */
export function useTestsForModule(
  module_name: string,
  options?: Partial<UseQueryOptions<TestOption[]>>
) {
  return useQuery<TestOption[]>({
    queryKey:  ["testsForModule", module_name],
    queryFn:   () => fetchTestsForModule(module_name),
    enabled:   !!module_name,
    staleTime: STALE.moduleTests,
    gcTime:    GC.moduleTests,
    ...options,
  });
}

export function useCreateTest(
  options?: UseMutationOptions<void, Error, { serial_no: string; name: string }>
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ serial_no, name }) => createTest(serial_no, name),
    onSuccess:  () => qc.invalidateQueries({ queryKey: QK.tests() }),
    ...options,
  });
}

export function useUpdateTest(
  options?: UseMutationOptions<void, Error, { oldName: string; newName: string; newSerialNo: string }>
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ oldName, newName, newSerialNo }) =>
      updateTest(oldName, newName, newSerialNo),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.tests() }),
    ...options,
  });
}

export function useDeleteTestCascade(
  options?: UseMutationOptions<void, Error, { name: string }>
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name }) => deleteTestCascade(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.tests() });
      qc.invalidateQueries({ queryKey: QK.dashboardSummaries() });
    },
    ...options,
  });
}

// ── Modules ───────────────────────────────────────────────────────────────────

export function useCreateModule(
  options?: UseMutationOptions<void, Error, { name: string }>
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name }) => createModule(name),
    onSuccess:  () => qc.invalidateQueries({ queryKey: QK.dashboardSummaries() }),
    ...options,
  });
}

export function useUpdateModule(
  options?: UseMutationOptions<void, Error, { oldName: string; newName: string }>
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ oldName, newName }) => updateModule(oldName, newName),
    onSuccess:  () => qc.invalidateQueries({ queryKey: QK.dashboardSummaries() }),
    ...options,
  });
}

export function useDeleteModule(
  options?: UseMutationOptions<void, Error, { name: string }>
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name }) => deleteModule(name),
    onSuccess:  () => qc.invalidateQueries({ queryKey: QK.dashboardSummaries() }),
    ...options,
  });
}

// ── Steps ─────────────────────────────────────────────────────────────────────

/** Steps for a test — used in the admin step editor and import modal. */
export function useStepOptions(
  tests_name: string,
  options?: Partial<UseQueryOptions<StepOption[]>>
) {
  return useQuery<StepOption[]>({
    queryKey:  ["stepOptions", tests_name],
    queryFn:   () => fetchStepOptions(tests_name),
    enabled:   !!tests_name,
    staleTime: STALE.moduleTests,
    gcTime:    GC.moduleTests,
    ...options,
  });
}

/** Steps via the get_steps_by_test RPC (used in CsvGenerator / revision flow). */
export function useStepsByTest(
  tests_name: string,
  options?: Partial<UseQueryOptions<StepOption[]>>
) {
  return useQuery<StepOption[]>({
    queryKey:  ["stepsByTest", tests_name],
    queryFn:   () => fetchStepsByTest(tests_name),
    enabled:   !!tests_name,
    staleTime: STALE.moduleTests,
    gcTime:    GC.moduleTests,
    ...options,
  });
}

/** Steps for a test (direct table query variant). */
export function useStepsForTest(
  tests_name: string,
  options?: Partial<UseQueryOptions<StepOption[]>>
) {
  return useQuery<StepOption[]>({
    queryKey:  ["stepsForTest", tests_name],
    queryFn:   () => fetchStepsForTest(tests_name),
    enabled:   !!tests_name,
    staleTime: STALE.moduleTests,
    gcTime:    GC.moduleTests,
    ...options,
  });
}

const STEP_QUERY_KEYS = (tests_name: string) => [
  ["stepOptions",  tests_name],
  ["stepsByTest",  tests_name],
  ["stepsForTest", tests_name],
];

export function useCreateStep(
  options?: UseMutationOptions<void, Error, ManualStepPayload>
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) => createStep(payload),
    onSuccess: (_data, vars) => {
      STEP_QUERY_KEYS(vars.tests_serial_no).forEach((k) =>
        qc.invalidateQueries({ queryKey: k })
      );
    },
    ...options,
  });
}

/** @deprecated test_steps are append-only per schema invariant. */
export function useUpdateStep(
  options?: UseMutationOptions<
    void,
    Error,
    { id: string; tests_serial_no: string; patch: { action: string; expected_result: string; is_divider: boolean } }
  >
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) => updateStep(id, patch),
    onSuccess: (_data, vars) => {
      STEP_QUERY_KEYS(vars.tests_serial_no).forEach((k) =>
        qc.invalidateQueries({ queryKey: k })
      );
    },
    ...options,
  });
}

/** @deprecated test_steps must never be deleted per schema invariant. */
export function useDeleteStep(
  options?: UseMutationOptions<void, Error, { id: string; tests_serial_no: string }>
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => deleteStep(id),
    onSuccess: (_data, vars) => {
      STEP_QUERY_KEYS(vars.tests_serial_no).forEach((k) =>
        qc.invalidateQueries({ queryKey: k })
      );
    },
    ...options,
  });
}

/** @deprecated See useDeleteStep. */
export function useDeleteStepWithResults(
  options?: UseMutationOptions<void, Error, { id: string; tests_serial_no: string }>
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => deleteStepWithResults(id),
    onSuccess: (_data, vars) => {
      STEP_QUERY_KEYS(vars.tests_serial_no).forEach((k) =>
        qc.invalidateQueries({ queryKey: k })
      );
    },
    ...options,
  });
}

export function useBulkCreateSteps(
  options?: UseMutationOptions<
    { written: number; errors: string[] },
    Error,
    { tests_name: string; rows: Record<string, unknown>[] }
  >
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tests_name, rows }) => bulkCreateSteps(tests_name, rows),
    onSuccess: (_data, vars) => {
      STEP_QUERY_KEYS(vars.tests_name).forEach((k) =>
        qc.invalidateQueries({ queryKey: k })
      );
    },
    ...options,
  });
}

/** @deprecated Use the revision-based import flow instead. */
export function useReplaceCsvSteps(
  options?: UseMutationOptions<void, Error, { tests_name: string; rows: CsvStepRow[] }>
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tests_name, rows }) => replaceCsvSteps(tests_name, rows),
    onSuccess: (_data, vars) => {
      STEP_QUERY_KEYS(vars.tests_name).forEach((k) =>
        qc.invalidateQueries({ queryKey: k })
      );
    },
    ...options,
  });
}