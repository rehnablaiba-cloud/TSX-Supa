export type Role = "admin" | "tester";

export interface AppUser {
  id: string;
  display_name: string;
  email: string;
  defaultRole: Role;
  disabled: boolean;
}

export interface Module {
  id: string;
  name: string;
  description?: string;
  accent_color?: string;
  created_at: string;
}

export interface Test {
  id: string;
  module_id: string;
  name: string;
  description?: string;
  order_index: number;
}

export interface Step {
  id: string;
  test_id: string;
  serial_no: number;
  action: string;
  expected_result: string;
  remarks: string;
  status: "pass" | "fail" | "pending";
  is_divider: boolean;
}

export interface TestLock {
  id: string;
  test_id: string;
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
