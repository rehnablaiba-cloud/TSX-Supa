/**
 * revisionDiffEngine.ts
 *
 * Pure TypeScript diff engine for TestPro revision control.
 * No framework or Supabase dependencies — can be unit-tested in isolation.
 *
 * Diff strategy: serial_no anchored
 *   • Same serial_no, identical action + expected_result  → UNCHANGED
 *   • Same serial_no, different action or expected_result → EDIT
 *   • serial_no present in CSV, absent in base            → INSERT
 *   • serial_no present in base, absent in CSV            → DELETE
 *
 * Step ID format (v4 schema):  {revId}-{seq:003}
 *   e.g.  R0-001,  RA-003,  RB-012
 */

// ─── Public types ─────────────────────────────────────────────────────────────

/** A step row loaded from an active revision (step_order resolved + serial_no assigned). */
export interface BaseStep {
  /** e.g. "R0-001" */
  id: string;
  /** 1-based position derived from step_order array index */
  serial_no: number;
  action: string;
  expected_result: string;
  is_divider: boolean;
  introduced_in_rev?: string;
  origin_step_id?: string | null;
}

/** A row parsed from the incoming CSV. */
export interface CsvRow {
  /** From explicit column, or 1-based positional if 3-col format */
  serial_no: number;
  action: string;
  expected_result: string;
  is_divider: boolean;
}

// ── Diff item variants ────────────────────────────────────────────────────────

export interface UnchangedItem {
  type: "UNCHANGED";
  /** Output position in the new step_order */
  position: number;
  serialNo: number;
  step: BaseStep;
}

export interface EditItem {
  type: "EDIT";
  position: number;
  serialNo: number;
  old: BaseStep;
  new: CsvRow;
  /** step.id of the superseded row — becomes origin_step_id of the new step row */
  originStepId: string;
}

export interface InsertItem {
  type: "INSERT";
  position: number;
  serialNo: number;
  row: CsvRow;
}

export interface DeleteItem {
  type: "DELETE";
  /** Appended after all output items for visibility in the UI */
  position: number;
  serialNo: number;
  step: BaseStep;
}

export type DiffItem = UnchangedItem | EditItem | InsertItem | DeleteItem;

export interface DiffSummary {
  unchanged: number;
  edited: number;
  inserted: number;
  deleted: number;
  total: number;
}

export interface DiffResult {
  items: DiffItem[];
  summary: DiffSummary;
}

// ── Revision payload (what gets written to DB) ────────────────────────────────

export interface RevisionMeta {
  id: string;
  test_id: string; 
  status: "draft";
  step_order: string[]; // ordered array of test_steps.id
  created_by: string; // user UUID
  notes: string;
}

// ── Revision payload ──────────────────────────────────────────────────────────

export interface NewStepRow {
  id: string;
  tests_serial_no: string;
  serial_no: number;            // ← ADD: needed by the DB trigger that mints id
  action: string;
  expected_result: string;
  is_divider: boolean;
  introduced_in_rev: string;
  origin_step_id: string | null;
}
export interface RevisionPayload {
  revision: RevisionMeta;
  /** Only the NEW rows to INSERT into test_steps. Unchanged steps are not repeated. */
  newSteps: NewStepRow[];
}

// ── CSV parse result ──────────────────────────────────────────────────────────

export interface ParseResult {
  rows: CsvRow[];
  warnings: string[];
  errors: string[];
}

// ─── CSV Parser (RFC-4180 compliant) ─────────────────────────────────────────

const DIVIDER_TRUE  = new Set(["true", "1", "yes", "y", "divider"]);
const DIVIDER_KNOWN = new Set([...DIVIDER_TRUE, "false", "0", "no", "n", ""]);

function tokenizeCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", inQ = false;
  // Strip BOM if present
  const src = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const nx = src[i + 1];

    if (inQ) {
      if (ch === '"' && nx === '"') { cell += '"'; i++; }   // escaped ""
      else if (ch === '"')          { inQ = false; }         // close quote
      else                          { cell += ch; }
    } else {
      if      (ch === '"')               { inQ = true; }
      else if (ch === ',')               { row.push(cell); cell = ""; }
      else if (ch === '\r' && nx === '\n') { row.push(cell); rows.push(row); row = []; cell = ""; i++; }
      else if (ch === '\n')              { row.push(cell); rows.push(row); row = []; cell = ""; }
      else                               { cell += ch; }
    }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }

  return rows.filter(r => r.some(c => c.trim()));
}

/**
 * Parse a CSV string into CsvRow[].
 *
 * Accepts two formats:
 *   3-col:  action, expected_result, is_divider          (serial_no = positional 1..N)
 *   4-col:  serial_no, action, expected_result, is_divider
 *
 * Header row is auto-detected and skipped.
 * Quoted fields with embedded commas / newlines are handled.
 */
export function parseCsv(raw: string): ParseResult {
  const rows: CsvRow[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  const allRows = tokenizeCsv(raw.trim());
  if (!allRows.length) {
    errors.push("CSV is empty.");
    return { rows, warnings, errors };
  }

  // ── Header / format detection ──
  const h0 = (allRows[0][0] ?? "").trim().toLowerCase();
  const h1 = (allRows[0][1] ?? "").trim().toLowerCase();
  let startIdx: number;
  let hasSN: boolean;

  const snHeaders  = new Set(["serial_no", "sn", "no", "sr", "#", "s/n", "seq"]);
  const actHeaders = new Set(["action", "step", "description"]);

  if (snHeaders.has(h0)) {
    startIdx = 1; hasSN = true;                    // 4-col with header
  } else if (actHeaders.has(h0) || h1 === "expected_result" || h1 === "expected") {
    startIdx = 1; hasSN = false;                   // 3-col with header
  } else if (!isNaN(Number(h0)) || h0 === "") {
    startIdx = 0; hasSN = true;                    // 4-col, no header (first col numeric)
  } else {
    startIdx = 0; hasSN = false;                   // 3-col, no header
  }

  let positionalSN = 0;

  for (let i = startIdx; i < allRows.length; i++) {
    const cols    = allRows[i].map(c => c.trim());
    const lineNum = i + 1;
    let snStr: string, action: string, expected_result: string, dividerRaw: string;

    if (hasSN) {
      [snStr, action, expected_result, dividerRaw] = cols as [string, string, string, string];
    } else {
      snStr = "";
      [action, expected_result, dividerRaw] = cols as [string, string, string];
    }

    positionalSN++;
    const snParsed = parseFloat(snStr);
    const serialNo = hasSN && !isNaN(snParsed) ? snParsed : positionalSN;

    if (!action) {
      errors.push(`Row ${lineNum}: action cannot be empty.`);
      continue;
    }
    if (!expected_result) {
      warnings.push(`Row ${lineNum} (S/N ${serialNo}): expected_result is empty.`);
    }
    if (dividerRaw && !DIVIDER_KNOWN.has(dividerRaw.toLowerCase())) {
      warnings.push(
        `Row ${lineNum} (S/N ${serialNo}): unrecognised is_divider "${dividerRaw}", defaulting to false.`
      );
    }

    rows.push({
      serial_no:       serialNo,
      action,
      expected_result: expected_result ?? "",
      is_divider:      DIVIDER_TRUE.has((dividerRaw ?? "").toLowerCase()),
    });
  }

  // ── Duplicate serial_no check ──
  const seen = new Map<number, number>();
  for (const r of rows) {
    const prev = seen.get(r.serial_no);
    if (prev !== undefined) {
      warnings.push(`Duplicate serial_no ${r.serial_no} found. Only the last occurrence will be used.`);
    }
    seen.set(r.serial_no, r.serial_no);
  }

  return { rows, warnings, errors };
}

// ─── Diff Engine ──────────────────────────────────────────────────────────────

function contentEqual(step: BaseStep, row: CsvRow): boolean {
  return (
    step.action          === row.action &&
    step.expected_result === row.expected_result &&
    step.is_divider      === row.is_divider
  );
}

/**
 * Compute a serial_no-anchored diff between the current active revision's steps
 * and the incoming CSV rows.
 *
 * @param base  Ordered BaseStep[] — serial_no is 1-based position from step_order.
 * @param csv   Parsed CsvRow[] from parseCsv().
 */
export function computeDiff(base: BaseStep[], csv: CsvRow[]): DiffResult {
  // Index base steps by serial_no for O(1) lookup
  const baseMap = new Map<number, BaseStep>(base.map(s => [s.serial_no, s]));

  // Index CSV rows by serial_no (last-write wins for duplicates)
  const csvMap  = new Map<number, CsvRow>(csv.map(r => [r.serial_no, r]));

  const items: DiffItem[] = [];
  let pos = 0;

  // ── Walk CSV rows in order → defines output sequence ──
  for (const row of csv) {
    const baseStep = baseMap.get(row.serial_no);
    pos++;

    if (!baseStep) {
      // serial_no not in base → INSERT
      items.push({ type: "INSERT", position: pos, serialNo: row.serial_no, row });
    } else if (contentEqual(baseStep, row)) {
      // Exact match → UNCHANGED
      items.push({ type: "UNCHANGED", position: pos, serialNo: row.serial_no, step: baseStep });
    } else {
      // Same serial_no, different content → EDIT
      items.push({
        type:         "EDIT",
        position:     pos,
        serialNo:     row.serial_no,
        old:          baseStep,
        new:          row,
        originStepId: baseStep.id,
      });
    }
  }

  // ── Base steps absent from CSV → DELETE (shown after output items) ──
  for (const step of base) {
    if (!csvMap.has(step.serial_no)) {
      pos++;
      items.push({ type: "DELETE", position: pos, serialNo: step.serial_no, step });
    }
  }

  // ── Summary ──
  const summary: DiffSummary = { unchanged: 0, edited: 0, inserted: 0, deleted: 0, total: items.length };
  for (const it of items) {
    if      (it.type === "UNCHANGED") summary.unchanged++;
    else if (it.type === "EDIT")      summary.edited++;
    else if (it.type === "INSERT")    summary.inserted++;
    else                              summary.deleted++;
  }

  return { items, summary };
}

// ─── Revision ID Utilities ────────────────────────────────────────────────────

/**
 * Suggest the next revision ID given an ordered list of existing IDs.
 *
 * mode = "iterate" → same prefix, increment suffix (RA-1 → RA-2)
 *         auto-branches if suffix has hit 10 (RA-10 → RB-1)
 * mode = "branch"  → new prefix, suffix = 1 (RA-3 → RB-1)
 *
 * R0 is special: only one variant (R0-1). Branching from R0 yields RA-1.
 */
export function getNextRevisionId(
  existingIds: string[],
  mode: "iterate" | "branch" = "iterate"
): string {
  if (existingIds.length === 0) return "R0-1";

  const prefixes = existingIds.map(r => r.split("-")[0]);

  if (mode === "branch") {
    if (!prefixes.includes("R0")) return "R0-1";
    const majors = prefixes.filter(p => p !== "R0").sort();
    if (majors.length === 0) return "RA-1";
    const lastCode = majors[majors.length - 1].charCodeAt(1);
    if (lastCode >= 90) throw new Error("Maximum major revisions (RZ) reached.");
    return `R${String.fromCharCode(lastCode + 1)}-1`;
  }

  // iterate: base on the prefix of the last created revision
  const lastId     = existingIds[existingIds.length - 1];
  const lastPrefix = lastId.split("-")[0];

  // R0 cannot have suffix > 1
  if (lastPrefix === "R0") return "RA-1";

  const suffixes = existingIds
    .filter(r => r.startsWith(lastPrefix + "-"))
    .map(r => parseInt(r.split("-")[1], 10))
    .filter(n => !isNaN(n));

  const maxSuffix = Math.max(...suffixes, 0);

  if (maxSuffix >= 10) {
    // Auto-branch when suffix is exhausted
    return getNextRevisionId(existingIds, "branch");
  }

  return `${lastPrefix}-${maxSuffix + 1}`;
}

/**
 * Returns the available suffix options for a given prefix:
 * existing suffixes 1..max + the next (max+1), capped at 10.
 */
export function getSuffixOptions(existingIds: string[], prefix: string): number[] {
  const suffixes = existingIds
    .filter(r => r.startsWith(prefix + "-"))
    .map(r => parseInt(r.split("-")[1], 10))
    .filter(n => !isNaN(n))
    .sort((a, b) => a - b);

  const maxExisting = suffixes.length > 0 ? suffixes[suffixes.length - 1] : 0;
  const next        = maxExisting < 10 ? maxExisting + 1 : null;

  const all = [...new Set([...suffixes, ...(next ? [next] : [])])].sort((a, b) => a - b);
  return all;
}
export function makeStepId(
  testsSerialNo: string,
  serialNo:      number,
  isDivider:     boolean
): string {
  return `${testsSerialNo}-${serialNo}-${isDivider}`;
}

// ─── Payload Builders ─────────────────────────────────────────────────────────

/**
 * Build the DB payload for the very first revision (no base to diff against).
 * All CSV rows become brand-new step rows.
 */
export function buildFirstRevisionPayload(
  rows:      CsvRow[],
  revId:     string,   // just the revision code, e.g. "R0-1"
  testName:  string,
  createdBy: string,
  notes:     string = ""
): RevisionPayload {
  const newSteps: NewStepRow[] = [];
  const stepOrder: string[]    = [];

  for (const r of rows) {
    const id = makeStepId(testName, r.serial_no, r.is_divider); // ← no minter
    newSteps.push({
      id,
      tests_serial_no:   testName,
      serial_no:         r.serial_no,
      action:            r.action,
      expected_result:   r.expected_result,
      is_divider:        r.is_divider,
      introduced_in_rev: revId,
      origin_step_id:    null,
    });
    stepOrder.push(id);
  }

  return {
    revision: { id: revId, test_id: testName, status: "draft",
                step_order: stepOrder, created_by: createdBy, notes },
    newSteps,
  };
}


 export function buildDiffRevisionPayload(
  diff:      DiffResult,
  revId:     string,
  testName:  string,
  createdBy: string,
  notes:     string = ""
): RevisionPayload {
  const newSteps: NewStepRow[] = [];
  const stepOrder: string[]    = [];

  for (const it of diff.items) {
    if (it.type === "DELETE") continue;

    if (it.type === "UNCHANGED") {
      stepOrder.push(it.step.id);

    } else if (it.type === "EDIT") {
      const id = makeStepId(testName, it.serialNo, it.new.is_divider); // ← no minter
      newSteps.push({
        id,
        tests_serial_no:   testName,
        serial_no:         it.serialNo,
        action:            it.new.action,
        expected_result:   it.new.expected_result,
        is_divider:        it.new.is_divider,
        introduced_in_rev: revId,
        origin_step_id:    it.originStepId,
      });
      stepOrder.push(id);

    } else if (it.type === "INSERT") {
      const id = makeStepId(testName, it.serialNo, it.row.is_divider); // ← no minter
      newSteps.push({
        id,
        tests_serial_no:   testName,
        serial_no:         it.serialNo,
        action:            it.row.action,
        expected_result:   it.row.expected_result,
        is_divider:        it.row.is_divider,
        introduced_in_rev: revId,
        origin_step_id:    null,
      });
      stepOrder.push(id);
    }
  }

  return {
    revision: { id: revId, test_id: testName, status: "draft",
                step_order: stepOrder, created_by: createdBy, notes },
    newSteps,
  };
}

// ─── Helper: resolve base steps from a revision ───────────────────────────────

/**
 * Given an ordered step_order array and a map of fetched step rows,
 * produce a BaseStep[] with 1-based serial_no matching array position.
 *
 * Usage:
 *   const stepMap = new Map(dbRows.map(r => [r.id, r]));
 *   const base    = resolveBaseSteps(stepOrder, stepMap);
 */
export function resolveBaseSteps(
  stepOrder: string[],
  stepMap:   Map<string, Omit<BaseStep, "serial_no">>
): BaseStep[] {
  return stepOrder.map((id, i) => {
    const s = stepMap.get(id);
    if (!s) {
      // Gracefully handle orphaned IDs (shouldn't happen in a healthy DB)
      return {
        id,
        serial_no:     i + 1,
        action:        `[missing step: ${id}]`,
        expected_result: "",
        is_divider:    false,
      };
    }
    return { ...s, serial_no: i + 1 };
  });
}
