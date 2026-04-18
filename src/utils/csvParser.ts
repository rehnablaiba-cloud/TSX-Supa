// src/utils/csvParser.ts
// Phase 2 — B4: RFC-4180 CSV parser + step CSV validator.
// Extracted from MobileNav.tsx (~65 lines of pure text-processing logic).
// Zero UI dependency — fully unit-testable independently.

import type { StepInput } from '../types';

// ── RFC-4180 compliant CSV parser ─────────────────────────────────────────────
// Handles: quoted fields, embedded commas, embedded newlines (Alt+Enter),
//          escaped double-quotes ("").
export function parseCsvToRecords(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuote = false;
  const src = text.replace(/
/g, '
').replace(//g, '
');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuote) {
      if (ch === '"') {
        // Escaped quote ("")  →  literal "
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else { inQuote = false; }
      } else {
        cell += ch; // embedded newline preserved as-is
      }
    } else {
      if      (ch === '"')  { inQuote = true; }
      else if (ch === ',')  { row.push(cell); cell = ''; }
      else if (ch === '
') {
        row.push(cell); cell = '';
        // skip completely blank lines
        if (row.some(c => c !== '')) records.push(row);
        row = [];
      } else {
        cell += ch;
      }
    }
  }
  // flush last cell / row
  row.push(cell);
  if (row.some(c => c !== '')) records.push(row);
  return records;
}

// ── Step CSV validator ────────────────────────────────────────────────────────
// Parses a CSV file expected to have columns:
//   serialno, action, expectedresult, isdivider
// Returns typed StepInput rows + any validation errors.
export function parseStepsCsv(
  text: string
): { rows: StepInput[]; errors: string[] } {
  const errors: string[] = [];
  const rows: StepInput[] = [];

  const records = parseCsvToRecords(text);
  if (records.length < 2) {
    errors.push('File is empty.');
    return { rows, errors };
  }

  const header = records[0].map(h => h.trim().toLowerCase().replace(/\s+/g, ''));
  const iSn  = header.indexOf('serialno');
  const iAct = header.indexOf('action');
  const iRes = header.indexOf('expectedresult');
  const iDiv = header.indexOf('isdivider');

  const missing = (
    [iSn  < 0 && 'serialno',
     iAct < 0 && 'action',
     iRes < 0 && 'expectedresult',
     iDiv < 0 && 'isdivider'] as (string | false)[]
  ).filter(Boolean) as string[];

  if (missing.length) {
    errors.push(`Missing columns: ${missing.join(', ')}`);
    return { rows, errors };
  }

  for (let i = 1; i < records.length; i++) {
    const cells = records[i];
    const snVal = parseInt(cells[iSn]?.trim() ?? '', 10);
    if (isNaN(snVal) || snVal < 1) {
      errors.push(`Row ${i + 1}: invalid serialno — skipped.`);
      continue;
    }
    rows.push({
      serialno:       snVal,
      action:         cells[iAct] ?? '',
      expectedresult: cells[iRes] ?? '',
      isdivider:      /^(true|1|yes)$/i.test(cells[iDiv]?.trim() ?? ''),
    });
  }

  return { rows, errors };
}
