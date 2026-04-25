// src/types/index.ts — canonical source of truth
export type Role = "admin" | "tester";

export interface AppUser {
  id: string;
  display_name: string;
  email: string;
  defaultRole: Role;
  disabled: boolean;
}

export interface Module {
  name: string;
  description?: string;
  created_at: string;
}

export interface Test {
  serial_no: string;
  name: string;
  description?: string;
  created_at: string;
}

export interface Step {
  id: string;
  serial_no: number;
  tests_name: string;
  action: string;
  expected_result: string;
  is_divider: boolean;
}

export interface ModuleTest {
  id: string;
  module_name: string;
  tests_name: string;
  test?: Test;
  step_results?: StepResult[];
}

export interface StepResult {
  id: string;
  module_name: string;
  test_steps_id: string;
  status: "pass" | "fail" | "pending";
  remarks: string;
  updated_at: string;
  display_name?: string;
  step?: Step;
}

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

export type ToastVariant = "success" | "error" | "info" | "warning";
export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

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
  module_name: string;
  test_name: string;
  locked_at: string;
}

export interface ModuleOption {
  name: string;
}

export interface TestOption {
  serial_no: string;
  name: string;
}

export interface StepInput {
  serial_no: number;
  action: string;
  expected_result: string;
  is_divider: boolean;
}
