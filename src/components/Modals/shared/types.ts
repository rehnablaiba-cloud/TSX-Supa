// ── Shared modal types for all Import/Export modals ─────────────────────────

export interface ModuleOption {
  name: string;
}

export interface TestOption {
  serialno: string;
  name:     string;
}

export interface StepOption {
  id:              string;
  serialno:        number;
  tests_name:      string;
  action:          string;
  expected_result: string;
  is_divider:      boolean;
}

export interface StepCsvRow {
  serialno:        number;
  action:          string;
  expected_result: string;
  is_divider:      boolean;
}

export interface StepImportSummary {
  written: number;
  skipped: number;
  errors:  string[];
}

// ── Op types ─────────────────────────────────────────────────────────────────
export type ModuleOp = "create" | "update" | "delete";
export type TestOp   = "create" | "update" | "delete";
export type StepOp   = "create" | "update" | "delete";

// ── Stage types ───────────────────────────────────────────────────────────────
export type ModuleManualStage =
  | "selectop" | "selectmodule" | "fillform"
  | "confirm"  | "submitting"   | "done";

export type TestManualStage =
  | "selectop" | "selecttest" | "fillform"
  | "confirm"  | "submitting" | "done";

export type StepManualStage =
  | "selectop"    | "selectmodule" | "selecttest"
  | "selectstep"  | "fillform"     | "confirm"
  | "submitting"  | "done";

export type StepImportStage =
  | "selecttest" | "selectop" | "upload"
  | "preview"    | "importing" | "done";

// ── Form types ────────────────────────────────────────────────────────────────
export interface StepForm {
  serialno:        string;
  action:          string;
  expected_result: string;
  is_divider:      boolean;
}

export const EMPTY_STEP_FORM: StepForm = {
  serialno: "", action: "", expected_result: "", is_divider: false,
};
