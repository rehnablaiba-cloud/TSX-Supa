/**
 * src/lib/queryClient.ts
 *
 * Single QueryClient instance shared across the entire app.
 * Import `queryClient` wherever you need programmatic cache access
 * (mutations, Realtime invalidations, signout flush).
 *
 * Design decisions:
 *  - 401 errors are NEVER retried by TanStack Query — the callRpc interceptor
 *    in rpc.ts owns that path (silent refresh → re-auth modal → retry).
 *  - Mutations never auto-retry — data integrity risk on duplicate writes.
 *  - Queries use `offlineFirst` so the cache is served while disconnected.
 *  - Mutations use `online` so writes are paused, not silently dropped,
 *    when the network is gone — TanStack re-fires them on reconnection.
 *  - Default staleTime / gcTime are conservative baselines; individual
 *    useQuery() calls override per the table in TESTPRO_OPTIMIZATION_PLAN §3.
 */

import { QueryClient } from "@tanstack/react-query";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function is401(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as Record<string, unknown>;
  // Supabase JS surfaces auth errors as { status: 401 } or { code: 'PGRST301' }
  return e["status"] === 401 || e["code"] === "PGRST301";
}

// ─── QueryClient ──────────────────────────────────────────────────────────────

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Serve stale cache while offline — testers never see a blank screen
      // when they momentarily lose connectivity mid-execution.
      networkMode: "offlineFirst",

      // Conservative baseline — individual queries override where noted.
      // Keeps data fresh enough for a live QA session without hammering Supabase.
      staleTime: 30 * 1000,        // 30 s
      gcTime:    10 * 60 * 1000,   // 10 min — survives route change + remount

      // Never let TanStack retry a 401 — the callRpc interceptor handles it.
      // For other errors, two retries is enough before surfacing the failure.
      retry: (failureCount, error) => {
        if (is401(error)) return false;
        return failureCount < 2;
      },

      // Exponential back-off capped at 30 s.
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),

      // Refetch when the user returns to the tab — cheap and keeps lock state
      // and dashboard counts from going stale during long background periods.
      refetchOnWindowFocus: true,

      // Do NOT refetch on reconnect by default — the Realtime reconnect handler
      // in each component issues targeted invalidations instead (§16 of plan).
      // Prevents a thundering herd of RPCs when the network comes back.
      refetchOnReconnect: true,
    },

    mutations: {
      // Hold writes while offline — TanStack re-fires them on reconnection.
      // Never silently drop a step result save.
      networkMode: "online",

      // Never auto-retry mutations — duplicate inserts / double status flips
      // are worse than a visible error the tester can manually retry.
      retry: false,
    },
  },
});

// ─── Stale-time constants ─────────────────────────────────────────────────────
// Import these in useQuery() calls instead of hardcoding magic numbers.
// Values match the table in TESTPRO_OPTIMIZATION_PLAN §3.

export const STALE = {
  /** Module list — changes rarely. */
  modules:        5  * 60 * 1000,
  /** Per-module test list — moderate change rate. */
  moduleTests:    10  * 60 * 1000,
  /** Dashboard summary — backed by materialized view. */
  dashboard:      30 *      1000,
  /** Active execution context — user is actively saving. */
  execution:      10  * 60 * 1000,
  /** Lock state — Realtime is the source of truth; cache is never stale. */
  locks:          0,
  /** Admin data — always fresh, intent-fired only. */
  admin:          0,
  /** Step results during active execution. */
  stepResults:    30 *      1000,
  /** Audit log — paginated, admin only. */
  auditLog:       30 *      1000,
  /** Session history for TestReport. */
  sessionHistory: 0,
} as const;

export const GC = {
  modules:        30 * 60 * 1000,
  moduleTests:    20 * 60 * 1000,
  dashboard:      10 * 60 * 1000,
  execution:      10 * 60 * 1000,
  locks:           5 * 60 * 1000,
  admin:           5 * 60 * 1000,
  stepResults:    10 * 60 * 1000,
  auditLog:       10 * 60 * 1000,
  sessionHistory:  5 * 60 * 1000,
} as const;

// ─── Query key factory ────────────────────────────────────────────────────────
// Centralised so mutations can import and invalidate without string-matching.
// Convention: [domain, ...params] — matches plan §3 and DevTools labels.

export const QK = {
  // Dashboard
  dashboardSummaries:    ()                        => ["dashboardSummaries"]          as const,
  activeLocks:           ()                        => ["activeLocks"]                 as const,
  otherActiveLocks:      ()                        => ["otherActiveLocks"]            as const,

  // Module dashboard
  moduleTests:           (name: string)            => ["moduleTests",    name]        as const,
  moduleCounts:          (name: string)            => ["moduleCounts",   name]        as const,
  moduleLocks:           (name: string)            => ["moduleLocks",    name]        as const,
  moduleStepDetails:     (name: string)            => ["moduleStepDetails", name]     as const,
  activeRevisions:       (sns: readonly string[])  => ["activeRevisions", ...sns]     as const,

  // Test execution
  executionContext:      (moduleTestId: string)    => ["executionContext", moduleTestId] as const,

  // Test report
  sessionHistory:        (user: string, start: string) => ["sessionHistory", user, start] as const,
  moduleOptions:         ()                        => ["moduleOptions"]               as const,

  // Audit log
  auditLog:              (page: number)            => ["auditLog",       page]        as const,

  // Admin
  tests:                 ()                        => ["tests"]                       as const,
  allTables:             ()                        => ["allTables"]                   as const,
} as const;
