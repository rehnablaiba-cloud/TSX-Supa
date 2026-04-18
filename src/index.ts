// src/types/index.ts

export type Role = 'admin' | 'tester';

export interface AppUser {
  id: string;
  displayname: string;
  email: string;
  defaultRole: Role;
  disabled: boolean;
}

export interface Module {
  name: string;          // PK text
  description?: string;
  createdat: string;
}

// Global test catalog — PK is name (text). serialno is float.
export interface Test {
  serialno: number;
  name: string;          // PK text
  description?: string;
  createdat: string;
}

// Global step definitions — PK: id = testsname|serialno (text)
export interface Step {
  id: string;            // text PK, built by trigger
  serialno: number;
  testsname: string;     // FK tests.name
  action: string;
  expectedresult: string;
  isdivider: boolean;
}

// Junction: module ↔ test — PK: id = modulename|testsname (text)
export interface ModuleTest {
  id: string;
  modulename: string;    // FK modules.name
  testsname: string;     // FK tests.name
  // joined relations (optional)
  test?: Test;
  stepresults?: StepResult[];
}

// Per-module execution results — PK: id = modulename|teststepsid (text)
export interface StepResult {
  id: string;
  modulename: string;    // FK modules.name
  teststepsid: string;   // FK teststeps.id
  status: 'pass' | 'fail' | 'pending';
  remarks: string;
  updatedat: string;
  displayname?: string;
  // joined relations (optional)
  step?: Step;
}

// Locks are per moduletest
export interface TestLock {
  id: string;
  moduletestid: string;  // FK moduletests.id
  userid: string;
  lockedbyname: string;
  lockedat: string;
}

export interface AuditEvent {
  id: string;
  userid: string;
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
  testname: string;
  stepsn: number;
  action: string;
  expectedresult: string;
  isdivider: boolean;
}

// ── Phase 2: A2 — Shared option interfaces ────────────────────────────────────
// Previously re-declared independently in queries.mobilenav.ts,
// queries.moduledashboard.ts, queries.testexecution.ts, queries.testreport.ts
export interface TestOption {
  serialno: string;
  name: string;
}

export interface ModuleOption {
  name: string;
}

// ── Phase 2: C2 — Unified step input ─────────────────────────────────────────
// Replaces CsvStepRow (queries.mobilenav.ts) + ManualStepPayload (queries.testexecution.ts)
// Both had identical shapes.
export interface StepInput {
  serialno: number;
  action: string;
  expectedresult: string;
  isdivider: boolean;
}
