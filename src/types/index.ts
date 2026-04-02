export type Role = "admin" | "tester";

export interface AppUser {
  id: string;
  display_name: string;
  email: string;
  defaultRole: Role;
  disabled: boolean;
}

// ── Global test catalog ──────────────────────────────────────
// A test is defined once and shared across all modules.
export interface Test {
  id: string;
  serial_no: number;       // unique test number across the catalog
  name: string;
  description?: string;
  created_at: string;
}

// ── Global step definitions (no results) ────────────────────
// Steps define what to do; execution results live in StepResult.
export interface Step {
  id: string;
  test_id: string;
  serial_no: number;
  action: string;
  expected_result: string;
  is_divider: boolean;
}

// ── Junction: module ↔ test ──────────────────────────────────
// Represents a test as it appears inside a specific module.
export interface ModuleTest {
  id: string;
  module_id: string;
  test_id: string;
  order_index: number;
  // joined relations (optional, populated by select queries)
  test?: Test;
  step_results?: StepResult[];
}

// ── Per-module execution results ─────────────────────────────
// One row per (module_test, step). Written during test execution.
export interface StepResult {
  id: string;
  module_test_id: string;
  step_id: string;
  status: "pass" | "fail" | "pending";
  remarks: string;
  updated_at: string;
  // joined relations (optional)
  step?: Step;
}

// ── Locks are now per module_test ────────────────────────────
// Two users can execute the same test in different modules simultaneously.
export interface TestLock {
  id: string;
  module_test_id: string;
  user_id: string;
  locked_by_name: string;
  locked_at: string;
}

export interface AuditEvent {
  id: string;
  user_id: string;
  username: string;
  action: string;
  severity: "pass" | "fail" | "warn" | "info";
  created_at: string;
}

export type ToastVariant = "success" | "error" | "info";
export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

// ── Import types (used by CSV import flow) ───────────────────
export interface ImportRow {
  test_number: number;
  test_name: string;
  step_sn: number;
  action: string;
  expected_result: string;
  is_divider: boolean;
}