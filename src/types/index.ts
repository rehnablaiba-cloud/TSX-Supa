export type Role = "admin" | "tester";

export interface AppUser {
  id: string;
  display_name: string;
  email: string;
  defaultRole: Role;
  disabled: boolean;
}

// ── Module ───────────────────────────────────────────────────
// PK is `name` (text). No UUID id column.
export interface Module {
  name: string;
  description?: string;
  created_at: string;
}

// ── Global test catalog ──────────────────────────────────────
// PK is `name` (text). serial_no is unique across the catalog.
export interface Test {
  serial_no: number;
  name: string;
  description?: string;
  created_at: string;
}

// ── Global step definitions (no results) ────────────────────
// PK is `serial_no` (integer). Steps are global — no test_id.
export interface Step {
  serial_no: number;
  action: string;
  expected_result: string;
  is_divider: boolean;
}

// ── Junction: module ↔ test ──────────────────────────────────
// id = module_name + "_" + tests_name (composite text PK)
export interface ModuleTest {
  id: string;
  module_name: string;
  tests_name: string;
  test?: Test;
  step_results?: StepResult[];
}

// ── Per-module execution results ─────────────────────────────
// id = module_steps_id + "_" + steps_serial_no (composite text PK)
export interface StepResult {
  id: string;
  module_steps_id: string;   // FK → module_tests.id
  steps_serial_no: number;   // FK → steps.serial_no
  status: "pass" | "fail" | "pending";
  remarks: string;
  updated_at: string;
  display_name?: string;
  step?: Step;
}

// ── Locks ────────────────────────────────────────────────────
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
