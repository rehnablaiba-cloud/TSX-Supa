/**
 * src/lib/r2.ts
 *
 * Read-only R2 client for static / non-changing data.
 * All writes are performed by R2MigrationModal (admin-only).
 *
 * Data stored in R2:
 *   modules/all.json          → R2Module[]
 *   tests/all.json            → R2Test[]
 *   revisions/all.json        → R2Revision[]  (all revisions, all statuses)
 *   step_orders/{revId}.json  → string[]       (ordered step IDs)
 *   test_steps/{revId}.json   → R2Step[]
 *
 * Caching strategy:
 *   A module-level Map acts as an in-memory L1 cache (TTL: 5 min).
 *   TanStack Query adds a second L2 layer on top (configured per query key).
 *   Per-revision keys (step_orders, test_steps) are effectively permanent
 *   within a session — revisions are immutable once published.
 */

import { supabase } from "../supabase";

// ── Config ────────────────────────────────────────────────────────────────────

const WORKER_URL = "https://shrill-thunder-6fdf.rehnab-rk.workers.dev";
const CACHE_TTL_MS = 5 * 60 * 1_000; // 5 min for mutable-ish keys (modules, tests, revisions)
const REVISION_TTL_MS = 60 * 60 * 1_000; // 1 h for immutable revision keys

// ── Auth ──────────────────────────────────────────────────────────────────────

async function getToken(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");
  return session.access_token;
}

// ── Core fetch ────────────────────────────────────────────────────────────────

async function r2Fetch<T>(key: string): Promise<T> {
  const token = await getToken();
  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "read", key }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? `R2 read failed: ${res.status} ${key}`);
  }

  return res.json() as Promise<T>;
}

// ── In-memory cache ───────────────────────────────────────────────────────────

interface CacheEntry {
  data: unknown;
  ts: number;
  ttl: number;
}

const _cache = new Map<string, CacheEntry>();

async function cachedFetch<T>(key: string, ttl = CACHE_TTL_MS): Promise<T> {
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.ts < hit.ttl) return hit.data as T;

  const data = await r2Fetch<T>(key);
  _cache.set(key, { data, ts: Date.now(), ttl });
  return data;
}

/**
 * Force-invalidate a single cache entry.
 * Call after a migration upload to ensure the next read picks up fresh data.
 */
export function r2Invalidate(key: string): void {
  _cache.delete(key);
}

/**
 * Invalidate all cached R2 entries.
 * Call after bulk migration or when the user triggers a manual refresh.
 */
export function r2InvalidateAll(): void {
  _cache.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type R2Module = {
  name:        string;
  description: string | null;
};

export type R2Test = {
  serial_no: string;
  name:      string;
};

export type R2Revision = {
  id:              string;
  revision:        string;
  tests_serial_no: string;
  status:          string; // "active" | "archived" | …
};

export type R2Step = {
  id:                  string;
  serial_no:           number;
  tests_serial_no:     string;
  action:              string;
  expected_result:     string;
  is_divider:          boolean;
  action_image_urls:   string[] | null;
  expected_image_urls: string[] | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/** All modules, sorted naturally by name (e.g. TS#01, TS#02 … TS#10). Cached 5 min. */
export async function r2GetModules(): Promise<R2Module[]> {
  const modules = await cachedFetch<R2Module[]>("modules/all.json");
  return modules.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  );
}

/** All tests, sorted naturally by name (e.g. T001, T002 … T010). Cached 5 min. */
export async function r2GetTests(): Promise<R2Test[]> {
  const tests = await cachedFetch<R2Test[]>("tests/all.json");
  return tests.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  );
}

/**
 * All revisions (all statuses).
 * Filter to `status === "active"` via r2GetActiveRevisions().
 * Cached 5 min.
 */
export function r2GetRevisions(): Promise<R2Revision[]> {
  return cachedFetch<R2Revision[]>("revisions/all.json");
}

/**
 * Ordered step IDs for a given revision.
 * Cached 1 h — revision step_order is immutable once published.
 */
export function r2GetStepOrder(revisionId: string): Promise<string[]> {
  return cachedFetch<string[]>(`step_orders/${revisionId}.json`, REVISION_TTL_MS);
}

/**
 * All test_steps rows for a given revision, sorted by serial_no ascending.
 * Cached 1 h — test_steps are immutable once published.
 */
export function r2GetTestSteps(revisionId: string): Promise<R2Step[]> {
  return cachedFetch<R2Step[]>(`test_steps/${revisionId}.json`, REVISION_TTL_MS);
}

/**
 * Convenience: active revisions keyed by tests_serial_no.
 *
 * If serialNos is provided, the result is filtered to those keys.
 * Returns an empty object if revisions/all.json has not been migrated yet.
 */
export async function r2GetActiveRevisions(
  serialNos?: string[]
): Promise<Record<string, R2Revision>> {
  let all: R2Revision[];
  try {
    all = await r2GetRevisions();
  } catch {
    // Graceful degradation: if R2 hasn't been seeded yet, return empty.
    // Callers should surface this as a "migration required" warning.
    return {};
  }

  const active = all.filter((r) => r.status === "active");

  const filtered =
    serialNos && serialNos.length > 0
      ? active.filter((r) => serialNos.includes(r.tests_serial_no))
      : active;

  return Object.fromEntries(filtered.map((r) => [r.tests_serial_no, r]));
}