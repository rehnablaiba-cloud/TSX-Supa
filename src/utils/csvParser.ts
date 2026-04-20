import type { StepInput } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// RFC 4180 tokenizer — handles quoted fields with embedded commas & newlines
// ─────────────────────────────────────────────────────────────────────────────

function parseCSV(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  // Normalise line endings
  const src = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        // Escaped quote inside quoted field
        field += '"';
        i++;
      } else if (ch === '"') {
        // End of quoted field
        inQuotes = false;
      } else {
        // Any char (including \n) inside quotes belongs to the field
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
      } else {
        field += ch;
      }
    }
  }

  // Flush last field / row
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);

  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// parseStepsCsv
// Expected columns (in order): serial_no, action, expected_result, is_divider
// ─────────────────────────────────────────────────────────────────────────────

export function parseStepsCsv(raw: string): {
  rows: StepInput[];
  errors: string[];
} {
  const allRows = parseCSV(raw.trimStart()); // strip BOM-caused leading whitespace
  const errors: string[] = [];
  const rows: StepInput[] = [];

  if (allRows.length === 0) {
    return { rows, errors: ["File is empty."] };
  }

  // Detect and skip header row
  const firstRow = allRows[0].map((c) => c.trim().toLowerCase());
  const hasHeader =
    firstRow.includes("serial_no") ||
    firstRow.includes("action") ||
    firstRow.includes("is_divider");
  const dataRows = hasHeader ? allRows.slice(1) : allRows;

  dataRows.forEach((cols, idx) => {
    const lineNum = idx + (hasHeader ? 2 : 1);

    if (cols.length !== 4) {
      errors.push(`Row ${lineNum}: expected 4 columns, got ${cols.length}`);
      return;
    }

    const [rawSn, action, expected_result, rawDivider] = cols.map((c) =>
      c.trim()
    );

    const serial_no = parseFloat(rawSn);
    if (isNaN(serial_no)) {
      errors.push(`Invalid serial_no: "${rawSn}" on row ${lineNum}`);
      return;
    }

    const is_divider =
      rawDivider.toLowerCase() === "true" || rawDivider === "1";

    rows.push({ serial_no, action, expected_result, is_divider });
  });

  return { rows, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// parseCsvToRecords — generic helper used elsewhere
// ─────────────────────────────────────────────────────────────────────────────

export function parseCsvToRecords(raw: string): Record<string, string>[] {
  const allRows = parseCSV(raw.trimStart());
  if (allRows.length < 2) return [];

  const headers = allRows[0].map((h) => h.trim());
  return allRows.slice(1).map((cols) => {
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      record[h] = (cols[i] ?? "").trim();
    });
    return record;
  });
}
