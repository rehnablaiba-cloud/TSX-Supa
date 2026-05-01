// src/components/ModuleDashboard/ModuleDashboard.types.ts
// Shared between ModuleDashboard.tsx and TestCard.tsx

export interface LockRow {
  module_test_id: string;
  user_id:        string;
  locked_by_name: string;
  locked_at:      string;
}

/**
 * Full step-result row — only fetched on-demand for CSV/PDF export.
 * Not held in component state during normal render.
 */
export interface TrimmedStepResult {
  id:     string;
  status: "pass" | "fail" | "pending";
  step: {
    id:              string;
    is_divider:      boolean;
    tests_serial_no: string;
    serial_no:       number | null;
    action:          string | null;
    expected_result: string | null;
  } | null;
}

/**
 * One test card — carries pre-aggregated counts from the RPC.
 * No raw step rows kept in memory.
 */
export interface ModuleTestRow {
  id:         string;
  tests_name: string;
  is_visible: boolean;
  test:       { serial_no: string; name: string } | null;
  pass:       number;
  fail:       number;
  pending:    number;
  total:      number;
}

export interface ActiveRevision {
  id:         string;
  revision:   string;
  step_order: string[];
}