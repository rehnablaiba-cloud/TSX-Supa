export type Role = "admin" | "tester";

export interface AppUser {
  id: string;
  display_name: string;
  email: string;
  defaultRole: Role;
  disabled: boolean;
}

export interface Module {
  name: string;              // PK (text)
  description?: string;
  created_at: string;
}

// ── Global test catalog ──────────────────────────────────────
// PK is name (text). serial_no is float.
export interface Test {
  serial_no: number;
  name: string;              // PK (text)
  description?: string;
  created_at: string;
}

// ── Global step definitions ──────────────────────────────────
// PK: id = tests_name || '_' || serial_no (text)
export interface Step {
  id: string;                // text PK built by trigger
  serial_no: number;
  tests_name: string;        // FK → tests.name
  action: string;
  expected_result: string;
  is_divider: boolean;
}

// ── Junction: module ↔ test ──────────────────────────────────
// PK: id = module_name || '_' || tests_name (text)
export interface ModuleTest {
  id: string;
  module_name: string;       // FK → modules.name
  tests_name: string;        // FK → tests.name
  // joined relations (optional)
  test?: Test;
  step_results?: StepResult[];
}

// ── Per-module execution results ─────────────────────────────
// PK: id = module_name || '_' || test_steps_id (text)
export interface StepResult {
  id: string;
  module_name: string;       // FK → modules.name
  test_steps_id: string;     // FK → test_steps.id
  status: "pass" | "fail" | "pending";
  remarks: string;
  updated_at: string;
  display_name?: string;
  // joined relations (optional)
  step?: Step;
}

// ── Locks are per module_test ────────────────────────────────
export interface TestLock {
  id: string;
  module_test_id: string;    // FK → module_tests.id
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
export interface ActiveLock {
  module_test_id: string;
  module_name:   string;
  test_name:     string;
  locked_at:     string;
}
export interface ModuleOption {
  name: string;
}

export interface TestOption {
  serial_no: string;
  name:     string;
}

export interface StepInput {
  serial_no:       number;
  action:         string;
  expected_result: string;
  is_divider:      boolean;
}