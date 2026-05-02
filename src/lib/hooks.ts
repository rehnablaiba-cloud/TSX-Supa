/**
 * src/lib/hooks.ts
 *
 * TanStack Query hooks — single import surface for all data access.
 * Components import ONLY from this file; never from rpc.ts or queryClient.ts directly.
 */

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
  checkTestLock,
  acquireLock,
  releaseLock,
  forceReleaseLock,
  heartbeatLock,
  updateStepResult,
  resetAllStepResults,
  fetchSignedUrls,
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
  // Types
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
} from "./rpc";

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
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. Realtime helpers
// ─────────────────────────────────────────────────────────────────────────────

export function invalidateModuleLocks(module_name: string): void {
  queryClient.invalidateQueries({ queryKey: QK.moduleLocks(module_name) });
}

/** Flush all cached data — call on sign-out. */
export function clearQueryCache(): void {
  queryClient.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Dashboard
// ─────────────────────────────────────────────────────────────────────────────

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

export function useModuleData(
  module_name: string,
  options?: Partial<UseQueryOptions<ModuleData>>
) {
  return useQuery<ModuleData>({
    queryKey:  QK.moduleCounts(module_name),
    queryFn:   () => fetchModuleData(module_name),
    enabled:   !!module_name,
    staleTime: STALE.moduleTests,
    gcTime:    GC.moduleTests,
    ...options,
  });
}

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

export function useModuleStepDetails(
  module_name: string,
  options?: Partial<UseQueryOptions<Record<string, TrimmedStepResult[]>>>
) {
  return useQuery<Record<string, TrimmedStepResult[]>>({
    queryKey:  QK.moduleStepDetails(module_name),
    queryFn:   () => fetchModuleStepDetails(module_name),
    enabled:   !!module_name,
    staleTime: STALE.locks,
    gcTime:    GC.locks,
    ...options,
  });
}

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

export function useActiveRevisions(
  serialNos:        string[],
  includeStepOrder  = false,
  options?: Partial<UseQueryOptions<Record<string, ActiveRevision>>>
) {
  const sorted = [...serialNos].sort();
  return useQuery<Record<string, ActiveRevision>>({
    queryKey:  QK.activeRevisions(sorted),
    queryFn:   () => getActiveRevisions(sorted, includeStepOrder),
    enabled:   sorted.length > 0,
    staleTime: STALE.moduleTests,
    gcTime:    GC.moduleTests,
    ...options,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Test Execution
// ─────────────────────────────────────────────────────────────────────────────

// ── Lock status query (lightweight, runs FIRST) ─────────────────────────────

export type LockStatus =
  | { status: "free" }
  | { status: "locked-by-self"; holderName?: string }
  | { status: "locked-by-other"; holderName: string };

/**
 * Check lock status for a single test BEFORE fetching execution context.
 * Lightweight: only checks test_locks table, no step data.
 */
export function useTestLock(
  module_test_id: string,
  module_name:    string,
  options?: Partial<UseQueryOptions<LockStatus>>
) {
  return useQuery<LockStatus>({
    queryKey:  ["testLock", module_test_id],
    queryFn:   () => checkTestLock(module_test_id),
    enabled:   !!module_test_id && !!module_name,
    staleTime: 0, // Always fresh — lock state changes rapidly
    gcTime:    5 * 60 * 1000,
    ...options,
  });
}

// ── Context query (gated by lock resolution) ────────────────────────────────

export function useTestExecutionData(
  module_test_id: string,
  module_name:    string,
  enabled:        boolean,
  options?: Partial<UseQueryOptions<TestExecutionData>>
) {
  return useQuery<TestExecutionData>({
    queryKey:  QK.executionContext(module_test_id),
    queryFn:   () => fetchTestExecutionData(module_test_id, module_name),
    enabled:   enabled && !!module_test_id && !!module_name,
    staleTime: STALE.execution,
    gcTime:    GC.execution,
    ...options,
  });
}

// ── Signed image URLs ───────────────────────────────────────────────────────

export function useSignedUrls(
  paths:   string[],
  options?: Partial<UseQueryOptions<Record<string, string>>>
) {
  const sorted = [...paths].sort();
  return useQuery<Record<string, string>>({
    queryKey:  ["signedUrls", ...sorted],
    queryFn:   () => fetchSignedUrls(sorted),
    enabled:   sorted.length > 0,
    staleTime: 50 * 60 * 1000,
    gcTime:    60 * 60 * 1000,
    ...options,
  });
}

// ── Lock mutations ──────────────────────────────────────────────────────────

type AcquireLockVars = {
  module_test_id: string;
  user_id:        string;
  display_name:   string;
};

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

export function useHeartbeatLock(
  options?: UseMutationOptions<void, Error, LockVars>
) {
  return useMutation<void, Error, LockVars>({
    mutationFn: ({ module_test_id, user_id }) => heartbeatLock(module_test_id, user_id),
    ...options,
  });
}

// ── Step result mutations ───────────────────────────────────────────────────

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
 * Does NOT invalidate executionContext — TestExecution.tsx owns local state.
 * Only invalidates aggregate dashboards so other views stay current.
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
      // REMOVED: qc.invalidateQueries({ queryKey: QK.executionContext(module_test_id) });
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

export function useResetAllStepResults(
  module_test_id: string,
  options?: UseMutationOptions<void, Error, ResetStepResultsVars>
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ResetStepResultsVars>({
    mutationFn: ({ module_name, stepResultIds, display_name }) =>
      resetAllStepResults(module_name, stepResultIds, display_name),
    onSuccess: () => {
      // REMOVED: qc.invalidateQueries({ queryKey: QK.executionContext(module_test_id) });
      qc.invalidateQueries({ queryKey: QK.dashboardSummaries() });
    },
    ...options,
  });
}

// ── Sign-out ─────────────────────────────────────────────────────────────────

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

export { insertTestStarted, insertTestFinished };

// ─────────────────────────────────────────────────────────────────────────────
// 7. Admin
// ─────────────────────────────────────────────────────────────────────────────

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