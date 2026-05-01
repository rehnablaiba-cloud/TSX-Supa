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
  const { data, error } = await supabase
    .from("step_results")
    .select(`
      id,
      status,
      updated_at,
      is_divider,
      display_name,
      module_name,
      test_steps:test_steps_id(
        serial_no,
        name,
        tests_serial_no,
        test:tests_serial_no(name)
      ),
      module_test:module_test_id(
        active_revision:test_revisions!module_tests_active_revision_id_fkey(revision)
      )
    `)
    .eq("display_name", username)
    .gte("updated_at", sessionStart)
    .order("updated_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id:              row.id,
    module_name:     row.module_name ?? "Unknown",
    tests_serial_no: row.test_steps?.tests_serial_no ?? "",
    test_name:       row.test_steps?.test?.name ?? row.test_steps?.name ?? "Untitled",
    status:          row.status,
    updated_at:      row.updated_at,
    revision:        row.module_test?.active_revision?.revision ?? null,
    is_divider:      row.is_divider ?? false,
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