/**
 * revisionDiffEngine.ts
 *
 * Pure TypeScript diff engine for TestPro revision control.
 * No framework or Supabase dependencies — can be unit-tested in isolation.
 *
 * Diff strategy: composite key anchored (serial_no + is_divider)
 *   • Same key, identical action + expected_result  → UNCHANGED
 *   • Same key, different action or expected_result → EDIT
 *   • key present in CSV, absent in base            → INSERT
 *   • key present in base, absent in CSV            → DELETE
 *
 * Step ID format (v4 schema):  {testSerialNo}-{revId}-{serialNo}-{isDivider}
 *   e.g.  T001-R0-1-1-true,  T001-RA-1-3-false
 */

// ─── Public types ─────────────────────────────────────────────────────────────

/** A step row loaded from an active revision (step_order resolved + serial_no assigned). */
export interface BaseStep {
  /** e.g. "T001-R0-1-1-true" */
  id: string;
  /** Stored serial_no from DB (preferred over positional fallback) */
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
  created_by: string;   // user UUID
  notes: string;
}

export interface NewStepRow {
  id: string;
  tests_serial_no: string;
  serial_no: number;
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
      if      (ch === '"')                     { inQ = true; }
      else if (ch === ',')                     { row.push(cell); cell = ""; }
      else if (ch === '\r' && nx === '\n')     { row.push(cell); rows.push(row); row = []; cell = ""; i++; }
      else if (ch === '\n')                    { row.push(cell); rows.push(row); row = []; cell = ""; }
      else                                     { cell += ch; }
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

  // ── Duplicate composite-key check ──
  // Warn only when both serial_no AND is_divider are identical (true collision).
  const seen = new Map<string, true>();
  for (const r of rows) {
    const k = `${r.serial_no}-${r.is_divider}`;
    if (seen.has(k)) {
      warnings.push(
        `Duplicate serial_no ${r.serial_no} + is_divider=${r.is_divider} found. Only the last occurrence will be used.`
      );
    }
    seen.set(k, true);
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
 * Composite map key: serial_no + is_divider.
 *
 * This prevents false EDIT/INSERT/DELETE collisions when divider rows share
 * a serial_no with the first content row in the same section (a common pattern
 * in TestPro CSVs where each section header has is_divider=true and the same
 * serial_no as the row below it with is_divider=false).
 */
const diffKey = (sn: number, div: boolean): string => `${sn}-${div}`;

/**
 * Compute a composite-key-anchored diff between the current active revision's
 * steps and the incoming CSV rows.
 *
 * @param base  Ordered BaseStep[] — serial_no comes from the DB column.
 * @param csv   Parsed CsvRow[] from parseCsv().
 */
export function computeDiff(base: BaseStep[], csv: CsvRow[]): DiffResult {
  // Index base steps by composite key for O(1) lookup
  const baseMap = new Map<string, BaseStep>(
    base.map(s => [diffKey(s.serial_no, s.is_divider), s])
  );

  // Index CSV rows by composite key (last-write wins for true duplicates)
  const csvMap = new Map<string, CsvRow>(
    csv.map(r => [diffKey(r.serial_no, r.is_divider), r])
  );

  const items: DiffItem[] = [];
  let pos = 0;

  // ── Walk CSV rows in order → defines output sequence ──
  for (const row of csv) {
    const k        = diffKey(row.serial_no, row.is_divider);
    const baseStep = baseMap.get(k);
    pos++;

    if (!baseStep) {
      // Key not in base → INSERT
      items.push({ type: "INSERT", position: pos, serialNo: row.serial_no, row });
    } else if (contentEqual(baseStep, row)) {
      // Exact match → UNCHANGED
      items.push({ type: "UNCHANGED", position: pos, serialNo: row.serial_no, step: baseStep });
    } else {
      // Same key, different content → EDIT
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
    if (!csvMap.has(diffKey(step.serial_no, step.is_divider))) {
      pos++;
      items.push({ type: "DELETE", position: pos, serialNo: step.serial_no, step });
    }
  }

  // ── Summary ──
  const summary: DiffSummary = {
    unchanged: 0, edited: 0, inserted: 0, deleted: 0, total: items.length,
  };
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
  revId:         string,
  serialNo:      number,
  isDivider:     boolean
): string {
  return `${testsSerialNo}-${revId}-${serialNo}-${isDivider}`;
  // e.g. T001-RA-1-3-false
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
    const id = makeStepId(testName, revId, r.serial_no, r.is_divider);
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
      const id = makeStepId(testName, revId, it.serialNo, it.new.is_divider);
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
      const id = makeStepId(testName, revId, it.serialNo, it.row.is_divider);
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
 * produce a BaseStep[] preserving the stored serial_no from the DB.
 * Falls back to the 1-based positional index only for orphaned IDs.
 *
 * Usage:
 *   const stepMap = new Map(dbRows.map(r => [r.id, r]));
 *   const base    = resolveBaseSteps(stepOrder, stepMap);
 */
export function resolveBaseSteps(
  stepOrder: string[],
  stepMap:   Map<string, Omit<BaseStep, "serial_no"> & { serial_no?: number }>
): BaseStep[] {
  return stepOrder.map((id, i) => {
    const s = stepMap.get(id);
    if (!s) {
      // Gracefully handle orphaned IDs (shouldn't happen in a healthy DB)
      return {
        id,
        serial_no:       i + 1,
        action:          `[missing step: ${id}]`,
        expected_result: "",
        is_divider:      false,
      };
    }
    // Prefer the stored DB serial_no; fall back to positional only if absent
    return { ...s, id, serial_no: s.serial_no ?? i + 1 };
  });
}