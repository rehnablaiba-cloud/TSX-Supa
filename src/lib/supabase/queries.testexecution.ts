/**
 * queries.testexecution.ts  (RPC rewrite — mirrors queries.moduledashboard.ts)
 *
 * Two round-trips, no streaming, no phases:
 *
 *  Round 1 (parallel):
 *    a. supabase.rpc("get_test_execution", { p_module_test_id, p_module_name })
 *       Joins test_steps ⋈ step_results in Postgres.
 *       Returns one row per step — ordered by step_order — with metadata scalars
 *       (is_visible, revision_id, revision_label, revision_serial_no) duplicated
 *       on every row so the caller reads them once from row[0].
 *    b. module_tests  (sidebar list — uses module_name prop already on hand)
 *    c. test_locks    (lock check for this module_test_id)
 *
 *  Round 2 (after round 1 resolves):
 *    d. test_revisions (active, for other tests' revision badges in the nav)
 *       Needs serialNos extracted from module_tests result — unavoidable.
 *
 * ─── SQL to deploy in Supabase SQL editor ────────────────────────────────────
 *
 *  create or replace function get_test_execution(
 *    p_module_test_id text,
 *    p_module_name    text
 *  )
 *  returns table (
 *    step_id              text,
 *    ord_idx              bigint,
 *    serial_no            integer,
 *    is_divider           boolean,
 *    action               text,
 *    expected_result      text,
 *    action_image_urls    text[],
 *    expected_image_urls  text[],
 *    tests_serial_no      text,
 *    result_id            text,
 *    status               text,
 *    remarks              text,
 *    display_name         text,
 *    -- scalar metadata: same on every row, read once from rows[0]
 *    is_visible           boolean,
 *    revision_id          text,
 *    revision_label       text,
 *    revision_serial_no   text
 *  )
 *  language sql stable security definer
 *  as $$
 *    with
 *    mt as (
 *      select is_visible, tests_name
 *      from   module_tests
 *      where  id = p_module_test_id
 *      limit  1
 *    ),
 *    sno as (
 *      select serial_no as tests_serial_no
 *      from   tests
 *      where  name = (select tests_name from mt)
 *      limit  1
 *    ),
 *    active_rev as (
 *      select id, revision, tests_serial_no, step_order
 *      from   test_revisions
 *      where  tests_serial_no = (select tests_serial_no from sno)
 *        and  status = 'active'
 *      limit  1
 *    ),
 *    fallback_order as (
 *      -- Used when there is no active revision (edge case)
 *      select array_agg(id order by serial_no) as step_order
 *      from   test_steps
 *      where  tests_serial_no = (select tests_serial_no from sno)
 *        and  not exists (select 1 from active_rev)
 *    ),
 *    effective_order as (
 *      select coalesce(
 *        (select step_order from active_rev),
 *        (select step_order from fallback_order)
 *      ) as step_order
 *    )
 *    select
 *      s.id                                         as step_id,
 *      ord.idx                                      as ord_idx,
 *      s.serial_no,
 *      s.is_divider,
 *      s.action,
 *      s.expected_result,
 *      s.action_image_urls,
 *      s.expected_image_urls,
 *      s.tests_serial_no,
 *      coalesce(sr.id,            '')               as result_id,
 *      coalesce(sr.status,        'pending')        as status,
 *      coalesce(sr.remarks,       '')               as remarks,
 *      coalesce(sr.display_name,  '')               as display_name,
 *      (select is_visible         from mt)          as is_visible,
 *      (select id                 from active_rev)  as revision_id,
 *      (select revision           from active_rev)  as revision_label,
 *      (select tests_serial_no    from active_rev)  as revision_serial_no
 *    from   unnest((select step_order from effective_order))
 *             with ordinality as ord(sid, idx)
 *    join   test_steps s   on s.id = ord.sid
 *    left   join step_results sr
 *               on  sr.test_steps_id = s.id
 *               and sr.module_name   = p_module_name
 *    order  by ord.idx;
 *  $$;
 *
 *  -- Recommended indexes (if not already present):
 *  create index if not exists idx_step_results_module_step
 *    on step_results (module_name, test_steps_id);
 *
 *  create index if not exists idx_test_revisions_serial_active
 *    on test_revisions (tests_serial_no, status);
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { supabase } from "../../supabase";


// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface RawStepResult {
  id: string;
  status: "pass" | "fail" | "pending";
  remarks: string;
  display_name: string;
  step: {
    id: string;
    serial_no: number;
    action: string;
    expected_result: string;
    is_divider: boolean;
    action_image_urls: string[];
    expected_image_urls: string[];
    tests_serial_no: string;
  } | null;
}

export interface RawModuleTestItem {
  id: string;
  tests_name: string;
  is_visible: boolean;
  test: { serial_no: string; name: string } | null;
}

export interface ActiveRevision {
  id: string;
  revision: string;
  tests_serial_no: string;
}

export interface TestExecutionData {
  module_name: string;
  is_visible: boolean;
  current_revision: ActiveRevision | null;
  active_revisions: Record<string, ActiveRevision>;
  module_tests: RawModuleTestItem[];
  step_results: RawStepResult[];
}

/** Lightweight cancellation token (kept for any callers still using it). */
export interface StreamCancellationToken {
  cancelled: boolean;
}


// ─────────────────────────────────────────────────────────────────────────────
// Internal — shape returned by the RPC
// ─────────────────────────────────────────────────────────────────────────────

interface RpcStepRow {
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
  // scalar metadata — same on every row
  is_visible:          boolean;
  revision_id:         string | null;
  revision_label:      string | null;
  revision_serial_no:  string | null;
}


// ─────────────────────────────────────────────────────────────────────────────
// fetchTestExecutionData  — main entry point (RPC-based)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches all data needed to render TestExecution in two round-trips.
 *
 * Round 1 (parallel):
 *   - RPC get_test_execution — step defs + results joined in Postgres
 *   - module_tests for the whole module (sidebar)
 *   - test_locks for this module_test_id
 *
 * Round 2 (sequential, needs serialNos from round 1):
 *   - test_revisions active (for revision badges on nav items)
 */
export async function fetchTestExecutionData(
  module_test_id: string,
  module_name: string
): Promise<TestExecutionData> {

  // ── Round 1: parallel ──────────────────────────────────────────────────────
  const [stepsRes, allMtRes] = await Promise.all([
    supabase.rpc("get_test_execution", {
      p_module_test_id: module_test_id,
      p_module_name:    module_name,
    }),
    supabase
      .from("module_tests")
      .select("id, tests_name, is_visible, test:tests!module_tests_tests_name_fkey(serial_no, name)")
      .eq("module_name", module_name)
      .order("tests_name"),
  ]);

  if (stepsRes.error) throw new Error(stepsRes.error.message);
  if (allMtRes.error)  throw new Error(allMtRes.error.message);

  const rows    = (stepsRes.data ?? []) as RpcStepRow[];
  const first   = rows[0] ?? null;

  // ── Extract metadata from row[0] scalars ───────────────────────────────────
  const is_visible: boolean = first?.is_visible ?? true;

  const current_revision: ActiveRevision | null =
    first?.revision_id
      ? {
          id:              first.revision_id,
          revision:        first.revision_label  ?? "",
          tests_serial_no: first.revision_serial_no ?? "",
        }
      : null;

  // ── Build RawStepResult[] (ordered — RPC already sorted by ord_idx) ────────
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
  const serialNos: string[] = module_tests
    .map((mt) => (mt as any).test?.serial_no as string | undefined)
    .filter((s): s is string => !!s);

  // ── Round 2: active revisions for all tests (nav badges) ──────────────────
  const active_revisions: Record<string, ActiveRevision> = {};

  if (current_revision) {
    // Seed with the current test's revision already in hand — avoids refetch
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
}


// ─────────────────────────────────────────────────────────────────────────────
// fetchTestExecution  (legacy alias — kept for backward compat)
// Only passes module_name=""; callers that need accuracy should switch to
// fetchTestExecutionData(id, module_name).
// ─────────────────────────────────────────────────────────────────────────────

/** @deprecated Use fetchTestExecutionData(module_test_id, module_name) instead. */
export async function fetchTestExecution(
  module_test_id: string,
  module_name = ""
): Promise<TestExecutionData> {
  return fetchTestExecutionData(module_test_id, module_name);
}


// ─────────────────────────────────────────────────────────────────────────────
// Lock management  (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

export async function acquireLock(
  module_test_id: string,
  user_id:        string,
  display_name:   string
): Promise<{ success: boolean; holder?: string }> {
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
}

export async function releaseLock(
  module_test_id: string,
  user_id:        string
): Promise<void> {
  const { error } = await supabase
    .from("test_locks")
    .delete()
    .eq("module_test_id", module_test_id)
    .eq("user_id", user_id);
  if (error) console.error("[releaseLock]", error.message);
}

export async function forceReleaseLock(module_test_id: string): Promise<void> {
  const { error } = await supabase
    .from("test_locks")
    .delete()
    .eq("module_test_id", module_test_id);
  if (error) console.error("[forceReleaseLock]", error.message);
}

export async function heartbeatLock(
  module_test_id: string,
  user_id:        string
): Promise<void> {
  const { error } = await supabase
    .from("test_locks")
    .update({ locked_at: new Date().toISOString() })
    .eq("module_test_id", module_test_id)
    .eq("user_id", user_id);
  if (error) console.error("[heartbeatLock]", error.message);
}


// ─────────────────────────────────────────────────────────────────────────────
// Step results  (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

const BATCH_SIZE = 500;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function upsertStepResult(payload: {
  test_steps_id: string;
  module_name:   string;
  status:        "pass" | "fail" | "pending";
  remarks:       string;
  display_name:  string;
}): Promise<void> {
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
}

export async function resetAllStepResults(
  module_name:   string,
  stepResultIds: string[],
  display_name:  string
): Promise<void> {
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
}


// ─────────────────────────────────────────────────────────────────────────────
// Signed image URLs  (batch API, unchanged)
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchSignedUrls(
  paths: string[]
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (!unique.length) return {};

  const batches = chunkArray(unique, 500);
  const allEntries: [string, string][] = [];

  for (const batch of batches) {
    const { data, error } = await supabase.storage
      .from("test_steps")
      .createSignedUrls(batch, 3600);

    if (error || !data) continue;

    for (const entry of data) {
      if (entry.signedUrl) allEntries.push([entry.path!, entry.signedUrl!]);
    }
  }

  return Object.fromEntries(allEntries);
}