/**
 * queries.testreport.ts
 *
 * Session History Only — fetches today's executed tests per user.
 * Execution happens on active revision only, so we don't need step_order.
 * We verify by updated_at time and display_name.
 */
import { supabase } from "../../supabase";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionHistoryEntry {
  id:              string;
  module_name:     string;
  tests_serial_no: string;
  test_name:       string;
  status:          "pass" | "fail" | "pending";
  updated_at:      string;
  revision:        string | null;
  is_divider:      boolean;
}

export interface SessionGroup {
  module_name:      string;
  tests_serial_no:  string;
  test_name:        string;
  revision:         string | null;
  steps:            SessionHistoryEntry[];
  pass:             number;
  fail:             number;
  undo:             number;
  total:            number;
  last_updated:     string;
}

export interface ModuleOption {
  name: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch session history for current user
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchSessionHistory(
  username:     string,
  sessionStart: string
): Promise<SessionHistoryEntry[]> {
  // Step 1: Fetch step_results with test_steps join
  // is_divider is on test_steps, not step_results
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

  // Step 2: Fetch active revisions for unique tests_serial_no
  const uniqueSerialNos = Array.from(new Set(
    rows.map((r) => r.test_steps?.tests_serial_no).filter(Boolean)
  ));

  const revisionMap = new Map<string, string>();
  if (uniqueSerialNos.length > 0) {
    const { data: revData, error: revErr } = await supabase
      .from("test_revisions")
      .select("revision, tests_serial_no")
      .eq("status", "active")
      .in("tests_serial_no", uniqueSerialNos);

    if (revErr) throw revErr;

    (revData ?? []).forEach((r: any) => {
      revisionMap.set(r.tests_serial_no, r.revision);
    });
  }

  // Flatten and merge
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch module options for filter dropdown
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchModuleOptions(): Promise<ModuleOption[]> {
  const { data, error } = await supabase
    .from("modules")
    .select("name")
    .order("name");

  if (error) throw error;
  return data ?? [];
}