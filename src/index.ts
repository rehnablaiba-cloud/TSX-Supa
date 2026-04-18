// src/types/index.ts

export type Role = 'admin' | 'tester';

export interface AppUser {
  id: string;
  display_name: string;
  email: string;
  defaultRole: Role;
  disabled: boolean;
}

export interface Module {
  name: string;          // PK text
  description?: string;
  createdat: string;
}

// Global test catalog — PK is name (text). serial_no is float.
export interface Test {
  serial_no: number;
  name: string;          // PK text
  description?: string;
  createdat: string;
}

// Global step definitions — PK: id = testsname|serial_no (text)
export interface Step {
  id: string;            // text PK, built by trigger
  serial_no: number;
  testsname: string;     // FK tests.name
  action: string;
  expected_result: string;
  is_divider: boolean;
}

// Junction: module ↔ test — PK: id = module_name|testsname (text)
export interface ModuleTest {
  id: string;
  module_name: string;    // FK modules.name
  testsname: string;     // FK tests.name
  // joined relations (optional)
  test?: Test;
  step_results?: StepResult[];
}

// Per-module execution results — PK: id = module_name|test_stepsid (text)
export interface StepResult {
  id: string;
  module_name: string;    // FK modules.name
  test_stepsid: string;   // FK test_steps.id
  status: 'pass' | 'fail' | 'pending';
  remarks: string;
  updatedat: string;
  display_name?: string;
  // joined relations (optional)
  step?: Step;
}

// Locks are per moduletest
export interface TestLock {
  id: string;
  module_test_id: string;  // FK module_tests.id
  user_id: string;
  locked_by_name: string;
  locked_at: string;
}

export interface AuditEvent {
  id: string;
  user_id: string;
  username: string;
  action: string;
  severity: 'pass' | 'fail' | 'warn' | 'info';
  createdat: string;
}

export type ToastVariant = 'success' | 'error' | 'info';
export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

// Import types used by CSV import flow
export interface ImportRow {
  testnumber: number;
  test_name: string;
  stepsn: number;
  action: string;
  expected_result: string;
  is_divider: boolean;
}

// ── Phase 2: A2 — Shared option interfaces ────────────────────────────────────
// Previously re-declared independently in queries.mobilenav.ts,
// queries.moduledashboard.ts, queries.testexecution.ts, queries.testreport.ts
export interface TestOption {
  serial_no: string;
  name: string;
}

export interface ModuleOption {
  name: string;
}

// ── Phase 2: C2 — Unified step input ─────────────────────────────────────────
// Replaces CsvStepRow (queries.mobilenav.ts) + ManualStepPayload (queries.testexecution.ts)
// Both had identical shapes.
export interface StepInput {
  serial_no: number;
  action: string;
  expected_result: string;
  is_divider: boolean;
}
