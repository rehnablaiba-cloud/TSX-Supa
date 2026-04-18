// src/utils/csvParser.ts
// Phase 2 B4: CSV parsing utilities extracted from MobileNav.tsx
import type { StepInput } from '../types';

/**
 * Parse a generic CSV string into an array of objects.
 * First row is treated as headers.
 */
export function parseCsvToRecords(
  text: string,
  sep = ','
): { rows: Record<string, string>[]; errors: string[] } {
  const lines  = text.trim().split(/\r?\n/);
  const errors: string[] = [];
  if (lines.length < 2) {
    return { rows: [], errors: ['CSV must have a header row and at least one data row.'] };
  }
  const headers = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, ''));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length !== headers.length) {
      errors.push(`Row ${i + 1}: expected ${headers.length} columns, got ${cols.length}`);
      continue;
    }
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = cols[idx]; });
    rows.push(obj);
  }
  return { rows, errors };
}

/**
 * Parse a steps-specific CSV.
 * Expected headers: serial_no, action, expected_result, is_divider
 */
export function parseStepsCsv(
  text: string
): { rows: StepInput[]; errors: string[] } {
  const { rows: raw, errors } = parseCsvToRecords(text);
  const required = ['serial_no', 'action', 'expected_result', 'is_divider'];

  if (raw.length > 0) {
    const missing = required.filter(h => !(h in raw[0]));
    if (missing.length) {
      return {
        rows: [],
        errors: [`Missing required columns: ${missing.join(', ')}`],
      };
    }
  }

  const rows: StepInput[] = [];
  for (const r of raw) {
    const sn = parseFloat(r['serial_no']);
    if (isNaN(sn)) {
      errors.push(`Invalid serial_no: "${r['serial_no']}"`);
      continue;
    }
    rows.push({
      serial_no:       sn,
      action:         r['action']         ?? '',
      expected_result: r['expected_result'] ?? '',
      is_divider:      r['is_divider']?.toLowerCase() === 'true',
    });
  }
  return { rows, errors };
}
